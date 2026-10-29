# TESTING.md

## Test layers (Phase 16, planned; state-machine unit tests ship in Phase 1)

- Unit: pricing maths, commission precedence, state machines, ledger
  derivation, promo caps, ranking formula.
- Integration: API + DB + Redis (testcontainers in CI), offer selection
  transaction, wallet settlement on completion, payout approval flow.
- API: contract tests against OpenAPI, auth/permission matrix tests
  (every admin endpoint × every role).
- WebSocket: room authorisation, reconnect snapshot, stale-GPS exclusion.
- E2E scenarios: customer register → request → choose offer → PIN →
  trip → pay → rate; driver register → KYC → approval → online → offer →
  trip → earnings; admin login → approve driver → monitor ride → inspect
  payment; delivery request → courier → pickup proof → transit → delivery proof.

## Critical concurrency tests (must pass before any launch)

1. Two drivers accepting / two customers selecting simultaneously — exactly one winner.
2. Customer selecting an expired offer — rejected, no state change.
3. Driver going offline during matching — removed from candidates, no stale offer.
4. Customer cancelling while driver accepts — exactly one terminal outcome, no orphan ride.
5. Duplicate payment callback — one settlement, second callback idempotent.
6. Duplicate completion request — one completion, one ledger settlement.
7. Repeated promo redemption — per-user limit enforced by DB constraint.
8. Duplicate wallet transaction (same idempotency key) — one ledger entry.
9. WebSocket reconnect — snapshot + authorised replay only, no leaked ride data.
10. Stale GPS update (old timestamp / teleport speed) — rejected or flagged, never used for matching.

## CI gates

Lint, format check, type check, unit + integration tests, build,
dependency/security audit. A failing critical test blocks deployment.
No test may depend on a real SMS, payment or map provider — providers are
mocked behind their interfaces.
