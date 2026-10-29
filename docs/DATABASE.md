# DATABASE.md — PostgreSQL 16 + PostGIS, Redis for hot location

## Conventions

- UUIDv7-style primary keys (`uuid`) where appropriate; integer serials only
  for append-only audit sequence numbers if needed.
- Every business table: `id, created_at, updated_at`. Financial and audit
  tables are append-only: no `UPDATE` of amount/actor in application code,
  no casual soft-delete.
- Money: `amount_minor` (integer, smallest currency unit, e.g. paisa for PKR)
  + `currency` (ISO code). Never float for money. All fare/commission maths
  is integer arithmetic server-side.
- Geography: `geography(Point, 4326)` for pickup/destination, zones as
  `geography(Polygon, 4326)`. GiST indexes on all geo columns.
- Soft delete (`deleted_at`) only where it cannot hide money or safety
  history: users, vehicles, promo codes. Never for ledger, payments,
  rides, ratings, audit or safety incidents. Account deletion = anonymisation
  workflow (see SECURITY.md), not row deletion.

## Core entities (see API-SPEC for field-level DTOs)

**Identity & access:** `users` (phone unique, email nullable unique, status,
suspension reason), `user_profiles`, `roles`, `permissions`,
`role_permissions`, `user_roles`, `devices`, `sessions` (refresh-token hash,
rotated, revoked), `otp_codes` (hashed code, expiry, attempts — never plaintext).

**Driver domain:** `driver_profiles` (kyc_status enum, rating aggregates
cached from ratings table), `driver_documents` (storage key only, never a
public URL; document type, expiry, review state), `driver_status_history`.

**Vehicles:** `vehicle_categories` (DB-driven: BIKE, CAR_ECONOMY,
CAR_STANDARD, CAR_PREMIUM + future RICKSHAW etc.), `vehicles`,
`vehicle_documents`, `driver_vehicle_assignments` (one active assignment
per driver enforced by a partial unique index).

**Geography & catalogue:** `cities`, `service_areas`, `zones` (polygon,
demand/supply counters are cached, not live-counted per request),
`service_types` (CAR, BIKE, DELIVERY + future types), `pricing_rules`
(versioned), `commission_rules` (versioned, scoped global/country/city/
service/driver).

**Rides:** `ride_requests` (pickup/destination geo, service, category,
suggested_fare_minor, customer_offer_minor, pricing_mode, pricing_rule_version,
status), `rides` (one per matched request, or 1:1 with request in v1 —
request and ride are kept separate so an unmatched request is not a ride),
`ride_offers` (driver, proposed fare, status, expires_at; unique partial
index: one live offer per driver per request), `ride_status_history`,
`ride_locations` (sampled, retention-limited), `ride_pin` (hashed PIN,
attempts, verified_at — separate table, not in rides).

**Deliveries:** `delivery_details` (sender/recipient, package category,
size/weight, notes, photo storage key), `delivery_proofs` (type OTP/PHOTO/
SIGNATURE, storage key or hashed OTP, verified_by, created_at, immutable).

**Money:** `wallet_accounts` (owner type: CUSTOMER/DRIVER/PLATFORM/COMMISSION/
BONUS, currency, derived balance — never written directly), `ledger_entries`
(account_id, type, amount_minor signed, reference_type, reference_id,
actor_id, reason, created_at, idempotency_key unique), `payments`
(status enum, provider, provider_reference, idempotency_key unique),
`refunds`, `payouts` (driver payout requests, status, reviewed_by).

**Commercial & support:** `promo_codes`, `promo_redemptions` (unique
(user_id, promo_id) partial index for per-user limit; usage counts updated
in the same transaction as redemption), `ratings` (unique (ride_id, rater_role)),
`notifications`, `support_tickets`, `support_messages`, `safety_incidents`,
`admin_actions`, `audit_logs`, `system_settings` (key unique, JSONB value,
changed_by, version).

## Key indexes (v1, to be confirmed by EXPLAIN on seed data)

- `rides(customer_id, created_at DESC)`, `rides(driver_id, created_at DESC)`,
  `rides(status) WHERE status NOT IN (terminal states)` (partial, live ops)
- `ride_offers(request_id, status)`, `ride_locations(ride_id, recorded_at)`
- `ledger_entries(account_id, created_at DESC)`, `ledger_entries(idempotency_key)` unique
- `driver_profiles(kyc_status)`, `vehicles(driver_id, status)`
- Geo: GiST on `ride_requests.pickup_geo`, `zones.boundary`, `cities` centre
- `sessions(user_id, revoked_at)`, `otp_codes(phone, expires_at)`

## Redis layout (hot, reconstructable, not source of truth)

- `drivers:{cityId}` — GEO set of online drivers
- `driver:{driverId}` — hash: status, category, service, last_seen, ride_id
- `ride:{rideId}:offers` — live offer ids (cache; DB is truth)
- `presence:{driverId}` — TTL key; expiry = stale
- BullMQ queues: `notifications`, `offer-expiry`, `payouts`, `analytics-events`
- Pub/Sub: Socket.IO adapter channels only; no business state in Pub/Sub.

## ER overview (textual; generate a visual ERD in Phase 1 with pgAdmin/eralchemy)

```
users 1──* user_roles *──1 roles *──* role_permissions *──1 permissions
users 1──1 user_profiles
users 1──* driver_profiles 1──* driver_documents
users 1──* vehicles (owner) ; drivers *──* vehicles via driver_vehicle_assignments
cities 1──* zones ; cities 1──* service_types (via city_services, Phase 2)
ride_requests *──1 users(customer) ; ride_requests 1──* ride_offers *──1 users(driver)
ride_requests 1──0/1 rides ; rides 1──* ride_status_history, ride_locations
rides 1──0/1 delivery_details 1──* delivery_proofs
rides 1──* payments ; payments 1──* refunds
wallet_accounts 1──* ledger_entries
users 1──* ratings (as rater and as rated, via ride)
rides 1──* support_tickets, safety_incidents, notifications
```

Migrations: one numbered SQL file per change under
`infrastructure/docker/init/` (dev) and `apps/api/migrations/` (Phase 2+),
applied by a migration runner, never by hand-editing a live schema.
