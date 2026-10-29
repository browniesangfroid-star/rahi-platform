# PHASE 11 — Delivery (done, tested)

## Objective
Deliveries are not rides with a different label: they carry a
package, a sender and a recipient, and proof that the package
actually changed hands. This phase adds that layer on top of the
existing request → dispatch → offer → trip flow, without forking it.

## What was built
- `apps/api/migrations/008_delivery_request_details_history.sql`:
  delivery_request_details (request-time copy), delivery_status_history,
  and an attempts column on delivery_proofs for OTP lockout.
- Delivery machine (`delivery-state-machine.ts`, mirrored in
  packages/shared-types): REQUESTED → COURIER_SELECTED →
  COURIER_EN_ROUTE_PICKUP → PICKED_UP → IN_TRANSIT → ARRIVED →
  DELIVERED, plus the three cancellation states. Package categories
  are a fixed list: DOCUMENT, FOOD, PARCEL, GROCERY, FRAGILE, OTHER.
- Request-time details: a DELIVERY request must include sender name
  and phone, recipient name and phone, and a package category
  (size/weight and notes optional); details on a non-delivery
  request are rejected. Details are stored per request so couriers
  see the package in their incoming list before offering, then
  copied onto the ride at accept.
- Accept setup: a delivery ride starts at COURIER_SELECTED and gets
  a recipient OTP — bcrypt hash in delivery_proofs, plaintext
  returned once in the accept response (the customer shares it with
  the recipient out of band). OTP hashes are never returned by any
  endpoint.
- Mirroring (DeliveryService owns delivery state, TripsService owns
  ride state; neither moves the other's status directly except
  through the mirror): trip en-route → COURIER_EN_ROUTE_PICKUP;
  ride PIN verified at the sender → PICKED_UP then IN_TRANSIT (the
  PIN is the pickup proof); ride cancellation → the matching
  delivery cancellation state.
- Recipient leg: courier marks arrived-at-recipient (IN_TRANSIT →
  ARRIVED), then verifies the recipient OTP (ARRIVED → DELIVERED).
  That verification is the only way a delivery ride completes — the
  generic /complete endpoint refuses delivery rides, so a courier
  cannot complete without proof. OTP lockout (5 attempts) is
  recovered by customer regenerate, which issues a fresh code.
- Photo evidence: couriers can upload package photos (private
  storage, participant-only download, same pattern as KYC documents).
  Photos are evidence, not a transition — they never move status.
- Endpoints under /trips/:rideId/delivery: get delivery, arrived-
  at-recipient, verify-otp, regenerate-otp, photo upload, photo
  download. Trip detail now includes delivery state for delivery
  rides.
- App clients: customer requestRide takes deliveryDetails, driver
  service has the delivery actions. Delivery screens land with the
  Phase 11 UI work in the apps' next pass.

## Verification (2026-10-28)
- [x] API tests pass 15/15, including the two new delivery e2e
      suites: details validation (missing details 400, details on
      a car request 400), full flow (COURIER_SELECTED → en-route
      mirror → PIN pickup → IN_TRANSIT → /complete refused → photo
      evidence without a status move → recipient arrival → wrong
      OTP 401 → correct OTP completing ride and delivery, photo
      download participant-only), OTP lockout recovered by
      regenerate, and cancellation mirroring.
- [x] Older DELIVERY requests in the rides and offers suites were
      updated to the new contract (valid details included) rather
      than the requirement being weakened.
- [ ] Postgres delivery store live-test — NOT run (same VM limit as
      Phases 3–10).

## Known limits
1. No delivery pricing by package category, size or weight yet —
   delivery uses the same fare formula as rides (Phase 12 can add
   category/weight surcharges behind pricing rules).
2. No sender/recipient SMS for the OTPs — the customer shares the
   recipient OTP out of band until the SMS vendor lands (Phase 12/13
   notification work).
3. No proof-of-delivery signature capture yet (OTP + photo only).

## Next: Phase 12 — Wallet, payments and commission (wallet accounts,
top-up, ride payment settlement, commission split, refunds).
