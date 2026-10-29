# PHASE 10 — Trip lifecycle (done, tested)

## Objective
Take a matched ride from selection to completion (or cancellation)
through the state machine, with a pickup PIN that actually proves
the right driver met the right customer — and honest rules for
when either side walks away.

## What was built
- `apps/api/src/trips/`: `trips.service.ts`, `trips.controller.ts`,
  `trips.module.ts`, `dto.ts`, `pin.ts`. Endpoints under `/trips`
  (deliberately not `/rides`, so they can never collide with the
  pre-match request cancel endpoint in RidesController):
  `GET /trips/:rideId`, `POST /trips/:rideId/en-route`,
  `/arrived`, `/begin-pin-verification`, `/verify-pin`,
  `/regenerate-pin`, `/complete`, `/cancel` (customer),
  `/driver-cancel` (driver), `/no-show` (driver),
  `POST /admin/trips/:rideId/cancel` (rides.cancel permission).
- Flow: DRIVER_SELECTED → DRIVER_EN_ROUTE → DRIVER_ARRIVED →
  WAITING_FOR_PIN → IN_PROGRESS → COMPLETED. Every transition goes
  through the shared ride state machine, is written to ride history,
  mirrors onto the request on completion/cancellation, and is
  broadcast as a `rideStatus` event to the ride's Socket.IO room.
- Pickup PIN: issued at accept time (Phase 8's accept response now
  includes `pin`). Only a bcrypt hash is stored in ride_pins; the
  plaintext is shown exactly once at accept, or again on regenerate.
  Verification allows 5 failed attempts, then locks until the
  customer regenerates the PIN (which resets attempts and replaces
  the hash). The trip detail endpoint reports only whether a PIN
  was issued and verified — never the PIN or its hash.
- Cancellation rules (from the machine, not invented here):
  customers and drivers can cancel only before the trip starts;
  a driver cancellation requires a reason; only an admin can cancel
  a trip in progress. A completed trip cannot be cancelled.
- No-show: the driver can claim it only from DRIVER_ARRIVED or
  WAITING_FOR_PIN, and only after waiting NO_SHOW_WAIT_MINUTES
  (default 5) measured from the recorded DRIVER_ARRIVED history
  entry. The outcome is CANCELLED_BY_DRIVER with reason NO_SHOW.
- Completion bumps the driver's trips-today count (feeds the
  Phase 7 fairness score on the next dispatch).
- App clients: customer RideService (getTrip, cancelTrip,
  regeneratePin) and driver DriverService (all trip actions) are
  ready; live-trip screens that wire them to buttons land in
  Phase 11's delivery work, where a current-ride context exists.

## Verification (2026-10-28)
- [x] API tests pass 13/13, including the two new trips e2e suites:
      full lifecycle (wrong actor 403, illegal transitions 409,
      wrong PIN 401 with attempt counting, correct PIN → IN_PROGRESS,
      in-progress customer cancel 409, completion → COMPLETED on
      ride and request, trips-today increment, detail payload
      containing no PIN), and cancel rules (customer cancel before
      pickup, driver cancel reason required, no-show rejected before
      arrival and accepted after, admin cancel in progress, PIN
      regenerate killing the old PIN, and lockout recovered by
      regenerate).
- [ ] Postgres trip store live-test — NOT run (same VM limit as
      Phases 3–9).

## Known limits
1. No cancellation fee or no-show penalty is charged yet — that is
   Phase 12 wallet/payments, where the money actually moves.
2. No driver penalty or strike system for cancellations/no-shows;
   reasons are recorded in history for Phase 14 support to act on.
3. Socket `rideStatus` broadcasts are emitted, but the app screens
   that display them are Phase 11 work.

## Next: Phase 11 — Delivery (sender/recipient details, package
categories, courier selection, pickup/delivery proofs, delivery
status machine).
