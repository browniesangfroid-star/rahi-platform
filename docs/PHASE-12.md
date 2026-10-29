# PHASE 12 — Wallet, payments and commission (done, tested)

## Objective
Turn completed rides into money movement: wallet payments settle
between customer, driver and platform; cash rides record the
commission the driver owes; refunds and cancellation fees have a
ledger trail; and nobody's balance is ever a column someone edits.

## What was built
- Migration 009: wallet top-ups, withdrawal requests, ride refunds,
  and the booking fee stored on the request at creation time
  (commission is calculated on fare excluding booking fee).
- Ledger-first money: balances are always derived from
  ledger_entries. Every entry carries an idempotency key, so a
  retried settlement, refund or fee can never double-post.
- Commission resolution by precedence — driver override →
  service+city → city → global → 15% pilot default — with the
  applied rate, commission amount and rule version stored on the
  ride at settlement. Admin endpoints create and list rules
  (commission.manage).
- Settlement (PaymentsService.settleRide, per-ride locked,
  idempotent):
  - WALLET: customer wallet pays the fare; driver wallet receives
    fare − commission; commission account receives the commission.
  - CASH: no wallet money moves; the commission is recorded as
    driver debt (negative driver balance) against the commission
    account. The driver clears it from future wallet earnings or a
    driver-wallet top-up.
  - Insufficient wallet: the trip stays COMPLETED and the payment
    goes FAILED; the customer tops up and retries settlement
    (POST /payments/rides/:rideId/settle). Settlement is attempted
    automatically at trip completion and at delivery OTP
    completion, and a failure there never rolls the trip back.
- Top-ups and withdrawals are request + admin approval (v1 has no
  payment provider that can auto-confirm, so approval IS the
  confirmation). Top-ups credit the wallet they were requested
  for (customer or driver). Withdrawal approval re-checks the
  balance at approval time and leaves the request pending if funds
  have moved. Payouts themselves remain an ops step outside the
  system — approval records the payout reference, it does not move
  bank money.
- Refunds (admin, wallet payments only): partial or full, with
  commission reversing proportionally so the platform does not keep
  full commission on a refunded fare. Payment status moves
  PAID → PARTIALLY_REFUNDED → REFUNDED.
- Cancellation fee: configurable via admin setting (default 0 in
  pilot). Charged on explicit customer/driver cancels of matched
  rides, credited to the commission account, and recorded as wallet
  debt when the balance is short — never silently dropped. Admin
  cancels never charge; pre-match cancels are free (no ride exists).
- Endpoints: GET /wallet/me, POST/GET /wallet/topups,
  POST/GET /wallet/withdrawals, POST/GET /payments/rides/:rideId
  (settle + settlement breakdown), admin top-up/withdrawal
  approve/reject, admin refund, admin commission rules, admin
  cancellation-fee setting.
- App clients: customer WalletService (balance, top-up, top-up
  list, settlement, retry) plus an ApiClient list helper; driver
  service wallet balance and withdrawal request.

## Verification (2026-10-28)
- [x] API tests pass 20/20, including five new payment suites:
      wallet settlement (fare 30000, fee 2000, base 28000, 15% =
      4200 commission, driver 25800, re-settle no-op), insufficient
      wallet → FAILED → top-up → retry PAID, cash commission debt
      with a driver override beating the global rate, partial then
      full refund with proportional commission reversal, and
      cancellation fee on matched cancel (not admin cancel) plus
      withdrawal approval.
- [ ] Postgres payments store live-test — NOT run (same VM limit
      as Phases 3–11).

## Known limits
1. No real payment provider: top-ups and payouts are admin-
   confirmed, not bank-verified. JazzCash/Easypaisa/Stripe
   providers land behind the same interfaces in a later phase.
2. No payout scheduling or driver payout batches — withdrawals
   are individual approvals.
3. Cancellation fees are not yet tiered by timing (before/after
   arrival); one flat configured fee applies to matched cancels.

## Next: Phase 13 — Super Admin (cities, pricing rules, service
and vehicle categories, package categories, and the settings
behind commission and fees, as managed admin resources).
