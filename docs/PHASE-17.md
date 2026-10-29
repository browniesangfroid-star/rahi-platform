# PHASE 17 — Deployment + demo simulator (done, tested)

## Objective
The final phase: make the platform deployable by someone other
than its author — a truthful runbook, a one-command demo that
proves a build works, a real document store, and the last
production-readiness gaps (socket fan-out, routing warnings,
readiness that actually probes).

## What was built
- S3 storage provider: `StorageProvider` interface with a local
  disk implementation (dev only, same key flattening as Phase 5
  so old files stay readable) and an S3-compatible implementation
  (AWS SDK v3, private bucket, downloads through the API with
  server credentials — never a public or presigned URL). Selected
  by `S3_BUCKET` in DataModule; missing credentials with a bucket
  set fail fast. Driver document upload/download now go through
  the provider; the service no longer touches the filesystem.
- Demo simulator (`apps/api/scripts/demo-simulator.mjs`,
  `npm --workspace apps/api run demo`): boots the real API
  in-process and runs signup → KYC approval → online →
  request → offer → accept → PIN trip → completion → rating →
  analytics, printing the numbers. It refuses
  `NODE_ENV=production` and any `DATABASE_URL`, so it can never
  touch real data. Verified run: fare 30000, commission 4200,
  analytics 1 requested / 1 completed.
- First-admin script (`apps/api/scripts/create-admin.mjs`):
  creates one SUPER_ADMIN from environment variables after
  migrations (12+ char password, never printed, existing email
  refuses instead of overwriting). There is still no API
  endpoint that mints admins — by design.
- Socket Redis adapter: with `REDIS_URL` the gateway attaches
  the Socket.IO Redis adapter in `afterInit`, so broadcasts reach
  clients connected to any API instance; without it the default
  in-memory adapter serves a single instance. Selection is a
  tested helper; adapter construction itself needs a live Redis.
- OSRM production warning: `MAPS_PROVIDER=osrm` without
  `OSRM_BASE_URL` now logs a loud DEV ONLY warning about the
  public demo server (in addition to the existing fallback to
  haversine on any OSRM failure).
- Real readiness: `/health/ready` now probes the database via a
  new `Store.ping()` (Postgres `SELECT 1`, in-memory `true`) and
  reports Redis as configured/unconfigured. Liveness drops the
  stale `phase-2-scaffold` label.
- Deployment groundwork: `docs/DEPLOYMENT.md` rewritten as a
  runbook (migrations as a separate job — correcting the old
  claim that the API migrates on start, which it never did;
  full env table; first admin; health gates; backups; own-OSRM
  steps with Geofabrik extracts and profiles; scaling notes
  separated into real-now vs later; CI/CD explicitly marked as
  to-wire-up, not existing). `infrastructure/docker/.env.example`
  refreshed to the variable names the code actually reads.
  API Dockerfile fixed: the runtime stage used to registry-install
  (which cannot resolve the workspace `@rahi/shared-types` and
  silently left dist broken); it now carries the build stage's
  node_modules plus the shared package.

## Verification (2026-10-28)
- [x] API tests pass 38/38 including new storage tests (local
      round-trip + flattening, S3 stub Put/GetObject) and the
      socket-adapter selection test.
- [x] Demo simulator runs end to end with correct numbers.
- [x] Admin web production build passes.
- [ ] NOT live-tested in this VM (no Docker/Postgres/Redis):
      Docker stack boot, Postgres accept transaction, Redis
      limiter, Redis socket adapter, S3 against real S3/MinIO,
      the create-admin script against real Postgres. All are
      reviewed and unit/stub tested; staging is their first real
      execution, and DEPLOYMENT.md says so.

## Known limits (carried to the end, honestly)
1. SMS delivery is log-only; no push notifications; Flutter
   apps are statically checked only. These were open decisions
   from Phase 0, not Phase 17 regressions.
2. On-read analytics want a materialised rollup at high volume.
3. Key rotation for `ENCRYPTION_KEY` still needs a
   re-encryption pass (Phase 16 note, unchanged).
4. OSRM routing uses the car `driving` profile for all services;
   a bicycle profile for BIKE is a tuning item.

## The platform, complete (Phases 0–17)
Docs → monorepo → auth/RBAC → customer app → driver KYC →
requesting → dispatch → offers → tracking → trips → delivery →
wallet/payments → super admin → support/safety → analytics →
hardening → deployment. Every phase's doc in `docs/PHASE-*.md`
records what was built, what was verified, and what was NOT.
