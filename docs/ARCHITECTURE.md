# ARCHITECTURE.md

## System diagram (logical)

```
                    ┌──────────────────┐
                    │  Customer app    │  Flutter, Android-first
                    │  Driver app      │  Flutter, Android-first
                    └──────┬───────────┘
                           │ HTTPS + WebSocket (Socket.IO)
                           ▼
                    ┌──────────────────┐
                    │  Nginx / LB      │  TLS, headers, rate limit (edge)
                    └──────┬───────────┘
                           ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Admin web    │──▶│  NestJS API      │──▶│  PostgreSQL 16   │
│ Next.js      │   │  (modular)       │   │  + PostGIS       │
└──────────────┘   │  REST /v1        │   │  (source of      │
                   │  Socket.IO GW    │   │   truth)         │
                   └─┬──────┬─────────┘   └──────────────────┘
                     │      │
              Redis  │      │  BullMQ queues
              (GEO,  │      ▼
               Pub/  │   ┌──────────────────┐
               Sub,  │   │ Workers          │
               cache)│   │ notifications,   │
                     │   │ offer expiry,    │
                     │   │ payouts, exports │
                     │   └──────┬───────────┘
                     │          │
                     ▼          ▼
              ┌──────────────────────────────┐
              │ Providers (interfaces only)  │
              │ Maps · Payments · SMS · Push │
              │ Storage (S3-compatible)      │
              └──────────────────────────────┘
```

Scale-out note: API instances are stateless. Socket.IO uses the Redis
adapter so a driver connected to instance A still receives an event
published by instance B. Do not store ride state in process memory.

## Backend modules (NestJS, one domain per module)

`auth`, `users`, `roles`, `drivers` (KYC, documents, vehicles), `cities`
(cities, zones, service areas), `pricing`, `commission`, `rides`
(requests, offers, state machine, PIN), `dispatch`, `tracking` (GPS ingest,
Redis GEO, trip locations), `deliveries`, `payments`, `wallet` (ledger),
`ratings`, `promotions`, `notifications`, `support`, `safety`, `admin`
(ops, audit, settings), `analytics` (read models, no PII in events).

Rules: controllers are thin (validate → call service → return DTO).
Business rules live in services. Money and state transitions live in
transactions. No controller touches a ledger or a state machine directly.

## Provider interfaces (never hardcode a vendor in domain code)

```ts
interface MapsProvider {
  geocode(address): Promise<GeoPoint>;
  reverseGeocode(point): Promise<Address>;
  route(origin, destination): Promise<{ distanceM, durationS, polyline }>;
  eta(origin, destination, vehicleCategory): Promise<number>;
}
interface PaymentProvider {
  charge(...): Promise<PaymentResult>;   // idempotencyKey required
  refund(...): Promise<RefundResult>;
  verifyWebhook(rawBody, signature): boolean;
}
interface SmsProvider { sendOtp(phone, code): Promise<void>; }
interface PushProvider { send(deviceTokens, payload): Promise<void>; }
interface StorageProvider { signedUploadUrl(...); signedReadUrl(...); }
```

v1 implementations: Maps = configurable (Google / Mapbox / OSM+OSRM behind
the interface); Payments = CASH + WALLET only, card/JazzCash/Easypaisa as
later providers; SMS/Push = FCM + one SMS vendor, both swappable.

## Ride state machine (server-enforced)

States: `DRAFT, SEARCHING, OFFERING, DRIVER_SELECTED, DRIVER_EN_ROUTE,
DRIVER_ARRIVED, WAITING_FOR_PIN, IN_PROGRESS, COMPLETED` and terminal
`CANCELLED_BY_CUSTOMER, CANCELLED_BY_DRIVER, CANCELLED_BY_ADMIN,
NO_DRIVER_FOUND, EXPIRED`.

Legal transitions (all others rejected with 409):

- DRAFT → SEARCHING
- SEARCHING → OFFERING | NO_DRIVER_FOUND | CANCELLED_BY_CUSTOMER | EXPIRED
- OFFERING → DRIVER_SELECTED | NO_DRIVER_FOUND | CANCELLED_BY_CUSTOMER | EXPIRED
- DRIVER_SELECTED → DRIVER_EN_ROUTE | CANCELLED_BY_CUSTOMER | CANCELLED_BY_DRIVER | CANCELLED_BY_ADMIN
- DRIVER_EN_ROUTE → DRIVER_ARRIVED | CANCELLED_* (same three)
- DRIVER_ARRIVED → WAITING_FOR_PIN | CANCELLED_*
- WAITING_FOR_PIN → IN_PROGRESS (PIN verified, or audited support override)
  | CANCELLED_*
- IN_PROGRESS → COMPLETED | CANCELLED_BY_ADMIN (only; customer/driver
  cancellation after start is a support dispute, not a silent cancel)
- Any non-terminal → EXPIRED only from SEARCHING/OFFERING on timeout.

Every transition appends to `ride_status_history` (ride_id, from, to, actor,
actor_role, reason, created_at). The machine lives in
`packages/shared-types/src/ride-state-machine.ts` and is imported by the
API — never duplicated in the apps.

## Delivery state machine

`REQUESTED → COURIER_SELECTED → COURIER_EN_ROUTE_PICKUP → PICKED_UP →
IN_TRANSIT → ARRIVED → DELIVERED`, with `CANCELLED_BY_CUSTOMER /
CANCELLED_BY_COURIER / CANCELLED_BY_ADMIN` from any non-terminal state
before DELIVERED. PICKED_UP requires pickup proof (OTP/photo, configurable);
DELIVERED requires delivery proof (OTP/photo/signature, configurable).
Delivery proof rows are immutable.

## DispatchService — documented ranking formula

Hard filters first (all must pass): online, KYC APPROVED, vehicle approved
and active, service/category match, city/zone match, not suspended, GPS
fresh, not already on a live ride, not declined this request in this round.

Score (weights configurable per city/service, defaults shown):

```
score = 0.45 * (1 - distanceKm / maxRadiusKm)
      + 0.20 * (driverRating / 5)
      + 0.20 * acceptanceRate
      + 0.15 * fairness   // 1 - (driver trips today / max trips today in city)
```

Distance uses road ETA when a MapsProvider route is available, otherwise
haversine as a documented fallback. The formula, weights and radius steps
are stored in `system_settings` and returned in admin analytics — no
black box. Offer rounds: batch of N (default 10) drivers, offer timeout
(default 45s), radius steps 2 → 4 → 7 → 10 km, max rounds (default 3).

## Realtime

Socket.IO namespaces/rooms: `ride:{rideId}` (customer + matched driver +
authorised ops only), `driver:{driverId}`, `user:{userId}`, `ops:city:{cityId}`
(admins with `rides.read` for that city). Auth: JWT on handshake, re-checked
on every room join. Events are listed in `API-SPEC.md`. On reconnect the
client requests a state snapshot; the server replays only events for rooms
the client is still authorised for.

## GPS tracking

- Ingest: `POST /drivers/location` (batched, authenticated) + Socket.IO
  `driver.location.updated` for live trips. Server validates speed
  (teleport flag), timestamp freshness and that the driver is online.
- Hot store: Redis GEO `drivers:{cityId}` + hash `driver:{id}` (status,
  category, last_seen). TTL on presence: missing pings expire presence.
- Durable store: `ride_locations` only for live rides (sampled per
  retention policy), plus `driver_locations` sampled archive. Never in `users`.
- Admin live map reads Redis + active rides, not the full history table.

## Demo mode (development only)

A simulator worker (Phase 17, behind `DEMO_MODE=true` and never in prod
builds) spawns virtual drivers around a city centre, moves them along
routes, counteroffers and completes trips. It is clearly labelled in the
admin UI and cannot create real payments or real KYC approvals.
