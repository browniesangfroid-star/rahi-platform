# PHASE 6 — Ride requesting (done, tested)

## Objective
Server-side estimate and request, with pricing rules as the authority:
no client fare is trusted, every estimate and request re-runs the same
integer-minor-unit maths, and every status change goes through the
ride state machine with a history row.

## What was built
- `apps/api/migrations/005_request_status_history.sql`: request history
  table + ride_requests columns for category, payment method, offer,
  distance and duration. This corrects the Phase 0 design: history for
  pre-match states (SEARCHING/OFFERING) lives here, because
  ride_status_history references post-match rides.
- `apps/api/src/rides/`: `geo.ts` (haversine + ETA), `pricing.service.ts`,
  `rides.service.ts`, `ride-state-machine.ts` (identical list to shared-types),
  `dto.ts`, `rides.controller.ts`, `rides.module.ts`
- Endpoints: `POST /rides/estimate`, `POST /rides/request`,
  `GET /rides`, `GET /rides/:id`, `GET /rides/:id/timeline`,
  `POST /rides/:id/cancel`
- Pricing formula (integer minor units):
  `max(minimum, base + distance × per_km + duration × per_min) × demand + booking_fee`
  with a full fare breakdown returned on every estimate.
- Pricing modes (per city/service rule, confirmed defaults):
  NEGOTIATION (car: offer must be ≥ minimum fare), FIXED (bike:
  customer offer ignored, platform fare applies), HYBRID (delivery:
  offer must be within ±20% of suggested fare), DYNAMIC (multiplier 1.0
  in Phase 6 — demand signals arrive with dispatch in Phase 7+).
- City resolution: nearest configured city centre within 50 km of
  pickup, otherwise "service not available in this area". Service/
  category validation: CAR → CAR_*, BIKE → BIKE, DELIVERY → any.
- Requests are created in SEARCHING with a 5-minute expiry, a history
  entry, and owner-only read/cancel (admins with rides.read may read).
  Cancel is allowed only from a state the machine allows (SEARCHING →
  CANCELLED_BY_CUSTOMER); cancelling a terminal request is a 409.
- The Phase 4 customer app now works end to end against these endpoints
  (its estimate/request field names already matched this contract).

## Verification (2026-10-28)
- [x] API tests pass 5/5, including the new rides e2e: estimate with
      breakdown and NEGOTIATION mode, service/category mismatch 400,
      out-of-area 400, invalid coordinates 400, negotiation offer below
      minimum 400, valid request SEARCHING with expiry, FIXED offer
      ignored, HYBRID out-of-band 400 / in-band accepted, ownership
      403 for read and cancel, timeline with the SEARCHING entry,
      cancel once then 409 on a second cancel.
- [ ] Postgres ride store live-test — NOT run (no Postgres in this VM).
      Note for Postgres runs: `service_types` and `vehicle_categories`
      must be seeded before ride requests work there (they are empty
      tables in migration 001; the admin UI for them lands in Phase 13,
      a dev seed script is the interim step).

## Known limits
1. Distance/ETA are haversine + speed-based, not road-network routing.
   A MapsProvider route replaces them in Phase 9 without changing the
   fare formula.
2. DYNAMIC multiplier is fixed at 1.0 until demand/supply signals exist.
3. Dispatch (Phase 7) and offers (Phase 8) do not consume these requests
   yet — a request stays SEARCHING until its 5-minute expiry logic is
   implemented as a BullMQ job in Phase 7.

## Next: Phase 7 — Driver dispatch (Redis GEO, expanding radius,
ranking, offer rounds, expiry, NO_DRIVER_FOUND).
