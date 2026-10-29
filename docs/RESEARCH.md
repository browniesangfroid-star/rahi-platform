# RESEARCH.md — Phase 0

## Method and boundary

Only legitimate public material was used: public documentation, public product
behaviour observable by an ordinary user, public system-design writing, and public
GitHub topics. No proprietary code, private API, trademarked asset, copyrighted UI
or backend/database dump was copied, requested or reproduced. Where a public
repository was found, this document records the *concept* only. Before reusing any
third-party code, the implementer must open that repository, confirm its licence
is compatible, and record the licence in the table below. Concepts are not code.

## 1. Passenger / customer workflow (publicly observable pattern)

Open app → map centres on current location → choose service (car / bike /
delivery) → pickup (default: current location) → destination → server returns
distance, ETA and a suggested fare → customer may propose their own fare in
negotiation mode → request is broadcast to nearby qualified drivers → offers
arrive in real time → customer picks one → other offers expire → driver travels
to pickup → trip PIN is exchanged → trip runs → payment → rating.

Key lesson: the booking funnel must be completable in under ~30 seconds when
locations are known. Every extra field after destination is friction and belongs
in delivery details, not in the ride funnel.

## 2. Driver workflow (publicly observable pattern)

Phone verification → profile → identity document → licence → vehicle +
registration + photos → bank/payout details → emergency contact → admin review
→ approved → go online → receive request cards → accept / counteroffer /
decline → navigate to pickup → PIN → trip → earnings update → rating.

Key lesson: KYC is a gate, not a form. `drivers cannot accept rides until
APPROVED`, and every KYC state change needs a reason, an actor and an audit row.

## 3. Fare negotiation / bidding (inDrive-style concept, original implementation)

Negotiation is a two-sided offer market, not an auction:

- The customer proposes a price; the server validates it against a floor
  (minimum fare / pricing-rule floor) so absurd offers cannot spam drivers.
- Nearby qualified drivers see the request and may accept, counteroffer once
  (configurable) or decline. Decline is a soft signal, not a punishment.
- The customer sees driver name, rating, completed trips, vehicle, colour,
  ETA and proposed fare. Plate display follows the privacy policy (masked
  until matched, full only to the matched customer and to authorised ops).
- Selection is atomic: one transaction, one winner, all other live offers
  expire in the same transaction. Expired-offer selection is rejected, not
  silently retried.
- If no offer is accepted before `offer_timeout`, the request expires
  (`EXPIRED`) and the customer may re-request at a revised fare.

This is distinct from automatic dispatch (Uber/Careem-style): there, the
platform assigns the nearest driver at a platform price. Rahi supports both,
per city/service, via `pricing_mode`: `NEGOTIATION | FIXED | DYNAMIC | HYBRID`.

## 4. Dispatch concepts (public system-design literature)

Public system-design writing converges on the same hot path:

- **Hot location index:** Redis GEO (`GEOADD` / `GEOSEARCH`) partitioned by
  city, with a skinny geo key (driver id only) and a separate hash for status,
  vehicle, rating and last-seen. One write per GPS ping; no read-modify-write.
- **Durable location:** PostgreSQL + PostGIS (`ST_DWithin`, GiST index) for
  city/zone checks, audit and analytics. Redis is the hot path; PostGIS is
  the record.
- **Staleness:** a driver with no GPS update inside the freshness window
  (default 45s idle, 15s on-trip — configurable) is excluded from matching
  even if the app still says "online".
- **Expanding radius:** 2 km → 4 km → 7 km → 10 km (configurable per
  city/service), then `NO_DRIVER_FOUND`. Cheap tight queries first.
- **Scoring, not just distance:** see `ARCHITECTURE.md` § Dispatch for the
  documented, non-black-box formula.
- **H3 (Uber's open-source hexagonal index)** is a legitimate later
  optimisation for surge/heatmap cells. It is not required for v1; PostGIS +
  Redis GEO covers city scale. Do not introduce H3 until driver counts make
  Redis GEO queries measurably slow.

Sources consulted in Phase 0 (public web search, Oct 2026):

- GitHub topic `ride-sharing-app` — small educational Flutter / React Native /
  Node projects showing rider/driver split and JWT auth. Useful for app
  structure only; none is used as a code base.
- Autofleet / locomotion (GitHub topic listing) — open-source rider app in
  React Native + Node. Concept: customisable ride-hailing core. Licence:
  **verify in repo before any reuse; none copied here.**
- Rezuanul-Islam-Fahim / taxi_app and taxi_app_driver (Flutter) — concept:
  separate rider and driver Flutter apps sharing a backend contract.
  Licence: **verify in repo before any reuse; none copied here.**
- Public dispatch writing (SharpByte, HelloSDE, CissyChen system-design notes,
  Redis GEO guides) — Redis GEO hot path, PostGIS durable path, expanding
  radius, driver lock (`SETNX`-style hold, superseded here by a DB row lock
  for the final winner), surge as demand/supply per zone/cell.
- NestJS + Socket.IO + BullMQ production write-ups — modular NestJS domains,
  Socket.IO rooms per ride, Redis Pub/Sub fan-out across API instances,
  BullMQ for notifications, offer expiry and payout jobs.

## 5. Ride lifecycle, GPS, wallets, ratings, cancellations, fraud

- **State machine:** every transition is enumerated, guarded server-side and
  appended to `ride_status_history`. See `ARCHITECTURE.md`.
- **GPS:** adaptive intervals — idle online 30s, approaching pickup 10s,
  active trip 5s, background 30s (configurable). High-frequency points live
  in Redis + a trip-location table with retention, never in `users`.
- **Wallet:** immutable ledger. Balance = `SUM(ledger_entries)`. No `UPDATE
  wallets SET balance = ...` anywhere. See `DATABASE.md` and `BUSINESS-RULES.md`.
- **Ratings:** only after `COMPLETED`, once per direction per ride, with a
  uniqueness constraint. Aggregates are recomputed from the ratings table,
  not trusted from client input.
- **Cancellations:** actor, timing and fee rules differ (before match, after
  match, after arrival). Fees are server-calculated from the pricing rule
  version in force at request time. Repeated late cancellations feed a
  fraud/risk flag, not an automatic ban — a human reviews.
- **Fraud controls (v1):** OTP rate limits, device/session limits, fare-floor
  validation, duplicate payment-callback idempotency, promo per-user limits
  with a DB unique constraint, GPS teleport detection (impossible speed
  between pings flags the trip for review), duplicate-device driver accounts
  flagged for KYC review.

## 6. Admin systems (publicly observable pattern)

Desktop-first ops console: live map, request queue, trip timeline, KYC queue,
wallet/payout review, pricing/commission editors with versioning, support
tickets scoped to one ride (no unrestricted access), audit log viewer.
Every sensitive admin action writes an immutable `admin_actions` / `audit_logs`
row with actor, target, before/after summary and reason.

## 7. What was deliberately NOT copied

No brand names, logos, colour schemes, screen layouts, copy or API shapes
from inDrive, Yango, Uber or Careem. The Rahi brand, tokens and screens in
later phases are original. "inDrive-style" in the brief is treated as a
business concept (customer-proposed fare + driver counteroffer), implemented
from scratch.

## Open research items for later phases

- Pakistan payment rails: JazzCash / Easypaisa sandbox docs and webhook
  signing (provider abstraction first; gateway second).
- FCM + SMS provider pricing and delivery rates in Pakistan for OTP.
- Map provider pricing: Google vs Mapbox vs OSM-based routing (OSRM) for
  Lahore / Karachi / Islamabad pilot cities.
- Local KYC document types and expiry rules to confirm with counsel.
