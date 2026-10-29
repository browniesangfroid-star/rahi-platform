# PHASE 7 — Driver dispatch (done, tested)

## Objective
Match a SEARCHING request to nearby, eligible drivers in expanding
radius rounds, ranked by a documented formula — and say plainly when
nobody is available, instead of leaving the request hanging.

## What was built
- `apps/api/migrations/006_driver_stats_dispatch_attempts.sql`:
  driver_stats (trips today, offers sent/accepted) and dispatch_attempts
  (request, driver, radius, score, distance, outcome).
- Location index (`apps/api/src/dispatch/`): `location-index.ts`
  interface, `in-memory-location-index.ts` (tests/dev) and
  `redis-location-index.ts` (production, Redis GEO). The index is the
  only thing matching queries — the database is never scanned for
  nearby drivers. `REDIS_URL` selects Redis; without it the API logs a
  DEV ONLY warning and uses the in-memory index.
- `dispatch.service.ts`: hard filters first, then ranking:
  - Online, GPS fresh (60 seconds), category match (index filters).
  - KYC APPROVED + an active approved vehicle (checked against the
    store, never trusted from index metadata).
  - Drivers who declined or timed out on this request are excluded.
  - Score = 0.45 × (1 − distance/maxRadius) + 0.20 × (rating/5)
    + 0.20 × acceptanceRate + 0.15 × fairness, where fairness in this
    phase is 1/(1 + tripsToday). ARCHITECTURE.md described fairness
    against the city's max trips today; that aggregate does not exist
    until Phase 15, so the implementation uses the same-shaped
    1/(1 + tripsToday) and says so here rather than pretending.
  - New drivers: rating defaults to 5.0 until rated, acceptance to
    0.5 until they have received offers (both documented defaults).
- Radius expansion: 2 → 4 → 7 → 10 km, batch of up to 10 drivers per
  round. Each round is recorded as dispatch attempts. If no round
  finds anyone, the request moves OFFERING → NO_DRIVER_FOUND.
- Request creation now auto-dispatches (Phase 6's response is re-read
  after dispatch so its status is the real OFFERING/NO_DRIVER_FOUND,
  not a stale SEARCHING snapshot). Re-dispatch of an OFFERING request
  is idempotent: it returns the last round without duplicating
  attempts. Admin endpoints: `POST /admin/dispatch/:requestId/run`
  (rides.assign) and `GET /admin/live-drivers` (rides.read).
- Driver endpoints: `POST /drivers/online`, `POST /drivers/offline`,
  `POST /drivers/location`. Going online enforces the same gate as
  accepting rides (APPROVED + active approved vehicle) and requires a
  location (a prior one is reused). Offline drivers' locations are
  stored but never matched.
- Driver app: the Online switch now calls the real endpoints and
  reflects the server's answer; a failure (e.g. no location yet)
  shows as an error, never as a silently flipped switch. GPS pings
  land in Phase 9.

## Verification (2026-10-28)
- [x] API tests pass 6/6, including the new dispatch e2e: ranking
      (closer + higher-rated driver first), exclusions (unapproved
      driver even with a forced index location, offline driver, stale
      GPS), online gate 409 for a DRAFT driver, idempotent re-dispatch
      (attempt count unchanged), a far request reaching
      NO_DRIVER_FOUND after all radii, and live-drivers listing.
- [x] The Phase 6 rides test was updated for auto-dispatch: it now
      brings one approved online driver up, and the request reaches
      OFFERING with a SEARCHING → OFFERING timeline.
- [ ] Redis location index live-test — NOT run (no Redis in this VM).
      Run against a real Redis before staging; the in-memory index is
      dev/test only and does not survive restarts or scale across
      instances.
- [ ] Postgres dispatch store live-test — NOT run (same VM limit as
      Phases 3–6).

## Known limits
1. Dispatch produces candidate rounds, not offers: Phase 8 turns a
   round into offers with accept/counter/decline and picks the winner.
   Until then, an OFFERING request has candidates but no selected
   driver, and its 5-minute expiry is not yet enforced by a job.
2. `live-drivers` lists online drivers by index state, including
   stale-GPS drivers (they are never matched, but they still appear
   in the list — a Phase 9 admin-map cleanup item).
3. In-memory dispatch state (declined sets are in the attempts table,
   but the index itself) is per-process; multi-instance production
   needs REDIS_URL.

## Next: Phase 8 — Fare bidding / offers (driver accept, counter-offer,
decline, customer selection, one winner by transaction).
