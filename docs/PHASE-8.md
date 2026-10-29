# PHASE 8 — Fare bidding / offers (done, tested)

## Objective
Turn a dispatch round into a real negotiation: dispatched drivers
offer, counter or decline, and the customer picks exactly one winner.
The winner becomes a matched ride; everyone else is superseded.

## What was built
- `apps/api/migrations/007_offer_counters_request_minimum.sql`:
  counter count on ride_offers, minimum fare stored on ride_requests
  at creation (offer validation never re-reads a pricing rule that
  may have changed since the request was made).
- `apps/api/src/offers/`: `offers.service.ts`, `offers.controller.ts`,
  `offers.module.ts`, `dto.ts`. Endpoints:
  `POST /rides/:requestId/offers` (driver), `GET /rides/:requestId/offers`
  (customer sees all, driver sees only their own, admin sees all),
  `POST .../offers/:offerId/accept` (customer),
  `POST .../offers/:offerId/decline` (driver),
  `POST .../offers/:offerId/counter` (driver),
  `GET /drivers/incoming-requests` (driver's dispatched OFFERING
  requests, each with their own live offer or null).
- Offer rules, enforced server-side:
  - Only a driver dispatched for the request (dispatch attempt
    OFFERED) can offer; one LIVE offer per driver per request.
  - NEGOTIATION: driver fare required, >= the request's minimum fare.
  - FIXED / DYNAMIC: platform fare applies, any driver fare ignored,
    counter-offers refused.
  - HYBRID: driver fare within ±20% of the suggested fare.
  - Counter-offers update the LIVE offer in place and increment its
    counter count (the one-live-offer unique index stays the guard).
  - Declining flips the dispatch attempt to DECLINED and bars the
    driver from offering again on that request.
- The one-winner moment: accept is serialised per request by an
  in-process lock chain, re-checks request status (OFFERING), offer
  status (LIVE), expiry and driver eligibility inside the lock, then
  creates exactly one rides row (DRIVER_SELECTED, final fare = the
  accepted offer, winner's active approved vehicle, request payment
  method), moves the request OFFERING → DRIVER_SELECTED, marks the
  winner ACCEPTED and every other live offer SUPERSEDED, and bumps
  the winner's accepted-offer count. The rides table's UNIQUE
  request_id is a second guard against duplicate rides.
- Expiry: accepting (or offering) on an expired request moves it to
  EXPIRED and expires its live offers instead of matching it.
- Offer listings are enriched with the driver's rating and active
  vehicle category, so the customer compares more than a price.
- Driver app: home now lists incoming dispatched requests with the
  driver's own live offer when online. Offer accept/counter UI for
  drivers lands with the live-trip screens in Phase 10 (the API
  already supports it).

## Verification (2026-10-28)
- [x] API tests pass 8/8, including the two new offers e2e suites:
      negotiation flow (dispatched-only offering, below-minimum
      rejection, one live offer, counter in place, ownership 403,
      accept → DRIVER_SELECTED ride with the accepted fare, loser
      SUPERSEDED, re-accept 409), concurrent accepts (exactly one
      201, one 409, exactly one ACCEPTED offer and one ride), decline
      exclusion (re-offer 409, attempt outcome DECLINED), fixed fare
      replacement, fixed counter refusal, hybrid band rejection and
      acceptance, and expiry on accept (request EXPIRED).
- [ ] Postgres offers store live-test — NOT run (same VM limit as
      Phases 3–7).

## Known limits
1. Accept serialisation is per-process. Multi-instance production
   needs the accept moved into a single database transaction
   (Phase 16 hardening item, recorded here, not hidden).
2. No real-time push yet: drivers learn about offers by polling
   incoming-requests, and customers by polling offers. Socket.IO
   push lands with live tracking in Phase 9.
3. Commission is not computed at accept time (final fare is stored,
   commission columns stay null until Phase 12 wallet/payments).

## Next: Phase 9 — Live tracking (GPS streaming, Socket.IO rooms,
ETA, road-network routing replacing haversine, driver map).
