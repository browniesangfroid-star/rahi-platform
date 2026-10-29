# PHASE 3 — Authentication & RBAC (done, tested)

## Objective
Real auth, not a login mock: phone OTP, admin email/password, JWT access
(15 min) + rotating opaque refresh tokens (30 days), granular permissions,
and admin MFA (TOTP), all behind a data-store interface.

## What was built
- `apps/api/src/data/`: `Store` interface, `InMemoryStore` (tests + dev
  without a DB, clearly warned on boot), `PostgresStore` (parameterised SQL
  against migrations 001–003)
- `apps/api/src/auth/`: `AuthService` (OTP, refresh rotation with
  reuse-detection revoking the whole session family, admin login, MFA
  setup/enable/verify via otplib), `JwtAuthGuard`, `PermissionsGuard`,
  `RequirePermissions`, DTOs with E.164 / email / 6-digit validation,
  `OtpRateLimiter` (5 OTPs per phone per 15 min), `LogSmsProvider`
- `apps/api/src/users/`: `GET /users/me`, `PATCH /users/me`
- `apps/api/src/rbac/`: `GET /admin/roles`, `POST /admin/roles`,
  `POST /admin/users/:userId/roles` (permission-guarded)
- `apps/api/migrations/003_auth_columns_rbac_seed.sql`: password_hash,
  phone_verified_at, mfa_secret, mfa_enabled + role/permission definitions
  and starter grants. No user accounts are seeded.
- Endpoints: `/auth/request-otp`, `/verify-otp`, `/refresh`, `/logout`,
  `/logout-all`, `/auth/admin/login`, `/auth/admin/mfa-verify`,
  `/auth/mfa/setup`, `/auth/mfa/enable`

## Verification (2026-10-28)
- [x] API tests pass: e2e OTP flow (bad format 400, wrong code 401,
      verify → tokens, `/users/me` 401 without token / 200 with token,
      refresh rotation + old token revoked, customer 403 on `/admin/roles`,
      super-admin 200, admin wrong password 401, MFA setup → enable →
      login requires MFA → verify succeeds) + rate-limiter unit test
- [x] Live smoke run: `/health` ok, `request-otp` → `{"sent": true}`,
      `/users/me` without token → 401, OTP code never logged (only a
      masked phone + "no SMS vendor configured" line)
- [ ] Postgres store live-tested — NOT yet (no Postgres in this VM).
      `PostgresStore` is implemented and SQL-reviewed, but must be run
      against a real Postgres + migrations before staging reliance.

## Known limits / hardening notes (do not hide these)
1. **SMS delivery is not real yet.** `LogSmsProvider` is the default until
   the SMS vendor decision (still open) is made. OTP logic, hashing,
   expiry and attempts are real; delivery is the missing piece.
2. **MFA secrets are stored as TEXT** in Phase 3. Encrypt at rest before
   production MFA rollout (Phase 16).
3. **OTP rate limiting is in-memory.** Multi-instance production must
   move it to Redis (Phase 16).
4. **JWT secret defaults** to a dev placeholder when `JWT_SECRET` is
   unset. Production must set a real secret via the secret manager;
   the dev default must never be used in prod (see SECURITY.md).
5. **In-memory store is dev/test only.** If `DATABASE_URL` is unset the
   API warns on boot and loses data on restart. That is intentional for
   local dev, not a production mode.

## Next: Phase 4 — Customer application (Flutter booking funnel, map,
service selector, estimate, request, offers UI against this API).
