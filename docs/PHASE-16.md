# PHASE 16 — Testing/security hardening (done, tested)

## Objective
Close the five hardening items carried since Phases 3–8, without
changing any user-facing behaviour: secrets at rest, shared rate
limiting, multi-instance-safe accept, one state machine, and a
closed socket CORS.

## What was built
- Encryption at rest (AES-256-GCM, `EncryptionService`): TOTP MFA
  secrets and driver bank account numbers are stored as
  `v1:<iv>:<tag>:<ciphertext>`. The key is `ENCRYPTION_KEY`
  (32 bytes, hex or base64); production without it refuses to
  boot, dev/test fall back to an ephemeral key with a warning
  (same precedent as the JWT dev fallback). Reads go through
  `decryptMaybe`: ciphertext decrypts, pre-Phase-16 plaintext
  still works, tampered ciphertext fails authentication instead
  of silently passing. Legacy rows migrate opportunistically
  (MFA re-encrypts on enable; bank accounts on re-registration)
  and the service never returns stored ciphertext to a client —
  register and driver-status responses carry the plaintext value
  back, and the stored record object is copied before decrypting
  so the in-memory store keeps ciphertext.
- Redis OTP rate limiting: `RedisOtpRateLimiter` (ioredis, one
  Lua script for atomic INCR + first-hit EXPIRE, same 5-per-15-min
  contract) is selected by the `OTP_RATE_LIMITER` factory in
  DataModule whenever `REDIS_URL` is set; otherwise the in-memory
  limiter with a dev warning. `AuthService` awaits the limiter
  now that both implementations are async.
- Single-transaction offer accept (Postgres): `acceptOfferAtomic`
  on the store, implemented by `PostgresStore` as one transaction
  that locks the request row (`SELECT ... FOR UPDATE`), re-checks
  OFFERING + LIVE inside the lock, then writes the ride, request
  status + history, offer outcomes, dispatch outcomes, driver
  stats, PIN and (for delivery) details + history + OTP proof —
  any failure rolls everything back. `OffersService` uses it when
  the store provides it and maps its error codes (plus PG 23505
  on the rides unique guard) to HTTP 404/409, never 500. The
  in-memory store keeps the per-process lock path — it is
  single-process by nature, so the lock is sufficient there.
- One state machine: `packages/shared-types` is now a real
  compiled package (`dist/`, CommonJS so the Nest app can
  require it, `main`/`types`/`exports` set, `build` script, API
  build runs the shared build first). The API's three duplicated
  machines are deleted; rides, trips, delivery, admin and drivers
  import `canTransition*` and `PACKAGE_CATEGORIES` from
  `@rahi/shared-types`. The cleanup also removed a duplication
  inside shared-types itself: the delivery machine lived in both
  `ride-state-machine.ts` and `delivery-state-machine.ts` (and
  `DeliveryStatus` was defined twice). `delivery-state-machine.ts`
  is now the single home, and shared tests import the compiled
  `dist/index.js` — the artifact the API consumes.
- Socket CORS: the gateway no longer allows `*`. Origins come
  from `SOCKET_CORS_ORIGINS` (comma-separated) or default to the
  local admin web (`http://localhost:3000`); a wildcard in the env
  value is filtered out, never honoured.

## Verification (2026-10-28)
- [x] API tests pass 35/35 (28 e2e + 7 new unit): encryption
      round-trip, tamper rejection, cross-key rejection, legacy
      passthrough; in-memory and Redis-stub limiter contracts;
      tx-path service wiring (PIN/OTP hashes handed to the
      transaction verified with bcrypt, delivery details passed
      through, conflict codes mapped to 409); socket CORS
      (default, env list, wildcard filtered).
- [x] Shared-types tests pass 3/3 against the compiled package.
- [x] Admin web production build passes.
- [ ] Postgres accept transaction live-test — NOT run (same VM
      limit as Phases 3–15: no Postgres here). The SQL is written
      against the real migration columns and reviewed, and the
      service-side wiring is unit-tested, but the transaction
      itself must run against real Postgres before staging
      reliance. Same for the Redis limiter against a real Redis.

## Known limits
1. No key rotation story yet: rotating `ENCRYPTION_KEY` requires
   re-encrypting stored values first (there is no key-version
   lookup beyond the `v1:` prefix). Do not rotate the key
   without that pass.
2. The bulk re-encryption of pre-Phase-16 plaintext rows is an
   ops task, not done here — there is no production data yet,
   and opportunistic migration covers rows as they are touched.
3. The JWT dev-fallback secret precedent still stands (Phase 3
   limit, unchanged): production must set `JWT_SECRET` and
   `ENCRYPTION_KEY`.
4. `dist/` is gitignored, so a fresh checkout must build the
   shared package before the API — the API build script now does
   that automatically.

## Next: Phase 17 — Deployment documentation + dev-only demo
simulator + S3 storage provider + own-OSRM production notes.
