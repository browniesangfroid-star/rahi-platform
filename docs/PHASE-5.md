# PHASE 5 — Driver onboarding & KYC (done, tested server-side)

## Objective
A driver cannot accept rides until the server says so: APPROVED KYC +
an active approved vehicle. Onboarding, documents, vehicles, review
queue and the approval gate are all server-enforced, with private
document storage and a full status history.

## What was built
- `apps/api/migrations/004_driver_documents_history.sql`: driver
  document + vehicle document tables, driver_status_history, emergency
  contact + bank columns on driver_profiles
- `apps/api/src/drivers/`: `kyc-state-machine.ts` (identical list to
  `packages/shared-types/src/driver-kyc-state-machine.ts`),
  `drivers.service.ts`, `drivers.controller.ts`, `admin-kyc.controller.ts`,
  `drivers.module.ts`
- Driver endpoints: `POST /drivers/register`, `GET /drivers/status`,
  `POST /drivers/submit`, `POST /drivers/documents` (multipart, jpg/png/
  pdf, max 10 MB, stored under STORAGE_DIR, never a public URL),
  `GET /drivers/documents/:id/file` (owner or drivers.approve admin only),
  `POST /drivers/vehicles`, `POST /drivers/vehicles/:id/activate`
- Admin endpoints: `GET /admin/kyc?status=`, `GET /admin/drivers/:userId/status`,
  `POST /admin/drivers/:userId/start-review|approve|reject|request-changes|suspend|reinstate`,
  `POST /admin/vehicles/:vehicleId/approve`
- Approval gate (tested): approve requires UNDER_REVIEW + CNIC +
  LICENCE + VEHICLE_REGISTRATION documents + at least one vehicle.
  Approve before review, and activation of an unapproved vehicle, are
  both rejected (409). Reject / suspend / request-changes require a
  reason (400 without one). Every transition writes driver_status_history
  + an audit log (Postgres; in-memory store records history only).
- Driver Flutter app (`apps/driver-mobile/lib/`, 5 Dart files): shared
  phone-OTP login, onboarding (emergency contact, document uploads,
  vehicle form), status view, and a home screen whose Online switch is
  disabled until the server reports canAcceptRides = true.

## Verification (2026-10-28)
- [x] API tests pass 4/4 (auth e2e + rate limiter + 2 driver e2e):
      register → documents → vehicle → submit → review → approve
      (before review = 409, queue shows UNDER_REVIEW, vehicle approve →
      driver approve → canAcceptRides false until activation → true
      after activation, history ≥ 3 entries); reject without reason =
      400, with reason = REJECTED with reason stored; document download
      403 for another driver, 200 for owner and admin
- [x] Driver app static checks: 5 Dart files, all relative imports
      resolve, brace/paren balance clean
- [ ] Flutter compile — NOT run (no Flutter SDK in this VM, same
      limitation as Phase 4)
- [ ] Postgres driver store live-test — NOT run (no Postgres in this VM)

## Known limits / decisions
1. **Request-changes is modelled as REJECTED with a reason** in Phase 5,
   because the KYC enum has no REQUEST_CHANGES state. The driver can
   resubmit (REJECTED → SUBMITTED). A distinct state would need a new
   enum value in a later migration — flagged for Phase 14, not hidden.
2. **Document storage is local disk** in Phase 5 (`STORAGE_DIR`,
   default `./uploads`, git-ignored). An S3-compatible provider replaces
   it in Phase 17. Files are private in both cases.
3. **Bank account is stored as plain text** in Phase 5, like MFA secrets
   in Phase 3. Encrypt sensitive fields at rest before production
   (Phase 16 hardening list).
4. **Driver app auth gating** is via driver-status error handling in
   Phase 5 (unauthenticated → OTP screen). A dedicated AuthState for
   the driver app is a Phase 7 cleanup item.

## Next: Phase 6 — Ride requesting (estimate, request, state machine
wiring, pricing-rule lookup, city/zone validation).
