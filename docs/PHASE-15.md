# PHASE 15 — Analytics (done, tested)

## Objective
Turn the operational tables into answers: how many rides, how
well matching works, which cities and drivers perform, and —
closing a documented Phase 7 deviation — city-max fairness in
the dispatch score.

## What was built
- AnalyticsStore (both stores): on-read aggregates, no separate
  ETL and no sampled data. `days` windows are 1–365; all
  boundaries are UTC.
  - `getRideStats`: requested, completed (by completion-history
    date), cancelled, no-driver-found, average fare, total
    commission. Cancelled counts requests only, because matched
    cancels mirror onto the request — counting rides too would
    double-count.
  - `getDispatchStats`: attempt counts by outcome and radius,
    average score, average match time (SEARCHING → DRIVER_SELECTED
    history entries), offers sent/accepted.
  - `getCityStats`, `getDriverLeaderboard` (completed rides,
    earnings = fare − commission regardless of cash/wallet
    settlement, average rating, offer acceptance), `getDailySeries`
    (requested by request date, completed and commission by
    completion date).
  - `getDriverTripsInCityToday` / `getCityFairness`: completed
    rides today in a city, grouped by driver, with the city max.
- Analytics API (`reports.read`, all under
  `/admin/analytics/`): overview, dispatch, cities, drivers
  (limit 1–100, default 20), daily, fairness/:cityId.
- Dispatch fairness, closed to the ARCHITECTURE.md formula:
  fairness = 1 − (driver trips in this city today / max trips
  in this city today), clamped to [0, 1], and 1 when nobody has
  run a trip in the city today. The fairness inputs are fetched
  once per dispatch, not per candidate. The candidate's
  `tripsToday` field now reports the city-day count the score
  actually used (previously the lifetime driver-stats counter).
  Supporting change: `DispatchAttemptRecord` gained `createdAt`
  (Postgres already stored it; InMemory now stamps it), so
  dispatch analytics can be windowed in both stores.
- Admin web gains an /analytics page: window selector (7/30/90
  days), overview and dispatch cards, daily bar series, city
  table, driver leaderboard.

## Verification (2026-10-28)
- [x] API tests pass 28/28, including two new analytics suites:
      a four-request scenario (2 completed, 1 matched-cancelled,
      1 pre-match-cancelled, ratings 5 and 4) where overview,
      dispatch, city, leaderboard, daily and fairness numbers
      all agree (completion 0.5, commission 8400, earnings
      51600, average rating 4.5, city max 2), plus guardrails
      (plain user 403, days=0 → 400, unknown city 404);
      and a live fairness test where a driver with two city
      trips today ranks below a fresh driver at identical
      distance, rating and acceptance.
- [x] Admin web production build passes (routes now include
      /analytics).
- [ ] Postgres analytics live-test — NOT run (same VM limit
      as Phases 3–14). The SQL is written against the real
      migration column names and reviewed, not executed.

## Known limits
1. On-read aggregates are fine at pilot scale; at high volume
   they want a materialised daily rollup (a Phase 17 ops note,
   not a v1 blocker).
2. Earnings are fare minus commission, not wallet cash-outs —
   a driver on cash rides "earns" the fare minus the commission
   debt they owe; the leaderboard does not claim money reached
   their bank.
3. Fairness is city-day only: a driver who ran 20 trips in
   another city today still counts as fresh in this city. That
   matches the documented formula, and it is the behaviour the
   test locks in.

## Next: Phase 16 — Testing/security hardening (encrypt MFA
secrets + bank accounts at rest, Redis OTP rate limiting,
single DB-transaction accept replacing the per-process lock,
unify duplicated state machines into one compiled shared
package, tighten socket CORS).
