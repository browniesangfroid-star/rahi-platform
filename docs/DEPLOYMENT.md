# DEPLOYMENT.md — Rahi production runbook (Phase 17)

## What runs where

- **API** (`apps/api`, NestJS): stateless. Any number of instances
  behind a load balancer, provided Postgres + Redis are shared
  (accept is a single DB transaction, OTP limiting is Redis, and
  Socket.IO fans out through the Redis adapter when `REDIS_URL`
  is set).
- **Admin web** (`apps/admin-web`, Next.js): static pages + API
  calls. Set `NEXT_PUBLIC_API_BASE_URL` to the public API origin.
- **Postgres 16 + PostGIS**: source of truth. **Redis 7**: GEO
  index, OTP limiting, socket adapter, queues later.
- **S3-compatible storage** (AWS S3 or MinIO): private bucket for
  driver KYC documents. Objects are never public; downloads go
  through the API with server credentials.

## Local development

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis minio
# api + admin-web images build from apps/api/Dockerfile and
# apps/admin-web/Dockerfile (compose profiles: app, storage)
npm --workspace apps/api run demo   # dev-only journey, in-memory, refuses real data
```

The demo simulator (`apps/api/scripts/demo-simulator.mjs`) runs
one full journey in-process against the in-memory store and
refuses to run with `NODE_ENV=production` or `DATABASE_URL` set.
It is the fastest way to prove a build works end to end.

## Deploying (staging / production)

1. **Migrations are a separate, reviewed job — the API does NOT
   run migrations on start.** Apply them in order, then verify:
   ```bash
   DATABASE_URL=postgres://... bash scripts/run-migrations.sh
   ```
   Migrations create empty tables only; no seed or demo rows.
2. **Environment.** Copy
   `infrastructure/docker/.env.example` to `.env` and fill every
   value. The full variable list, with what the code actually
   reads:
   | Variable | Required in prod | Notes |
   |---|---|---|
   | `DATABASE_URL` | yes | Postgres + PostGIS |
   | `REDIS_URL` | yes | Shared limiting, GEO, socket adapter; without it, single-instance fallbacks + warnings |
   | `JWT_SECRET` | yes | No usable default |
   | `ENCRYPTION_KEY` | yes | 32 bytes (hex/base64); boot refuses without it in production |
   | `MAPS_PROVIDER` | no | `haversine` (default) or `osrm` |
   | `OSRM_BASE_URL` | with osrm | Your own OSRM instance (see below); unset = public demo server + warning |
   | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | Private bucket; without a bucket, local disk (dev only) |
   | `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | with MinIO | Endpoint + path style for MinIO |
   | `SOCKET_CORS_ORIGINS` | no | Comma-separated browser origins; default is local admin web; `*` is ignored |
   | `STORAGE_DIR` | no | Local-disk root, only when `S3_BUCKET` is unset |
   | `PORT` | no | Default 3001 |
3. **First admin.** There is no API endpoint that creates admins
   out of thin air, and no production password exists in the
   repo. Create the first SUPER_ADMIN from an operator shell
   after migrations, then enable MFA on first sign-in:
   ```bash
   DATABASE_URL=postgres://... ADMIN_EMAIL=ops@example.com \
     ADMIN_PASSWORD='<at least 12 chars>' \
     node apps/api/scripts/create-admin.mjs
   ```
   The password comes from the environment only and is never
   printed. Re-running for an existing email refuses.
4. **Health gates.** `/api/v1/health` is liveness (process up).
   `/api/v1/health/ready` probes the database (`ready` only when
   the DB answers) and reports Redis as `configured` /
   `not-configured`. Point load-balancer health checks at
   `/ready`, not `/`.
5. **Backups.** Daily Postgres dumps + point-in-time recovery;
   Redis AOF persistence (compose enables `--appendonly yes`);
   S3 versioning on the documents bucket.

## Running your own OSRM (production routing)

The public demo server (`router.project-osrm.org`) is a shared
demo, not a production dependency: no SLA, rate limits, and your
riders' coordinates leave your infrastructure. Self-hosting:

```bash
# 1. Download an extract (Geofabrik; Punjab or Pakistan for the pilot)
#    e.g. punjab-latest.osm.pbf
# 2. Prepare (car profile; add a bike profile for BIKE routing)
docker run -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/punjab-latest.osm.pbf
docker run -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-partition /data/punjab-latest.osrm
docker run -t -v "$PWD:/data" osrm/osrm-backend \
  osrm-customize /data/punjab-latest.osrm
# 3. Serve
docker run -t -p 5000:5000 -v "$PWD:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld /data/punjab-latest.osrm
# 4. Point the API at it
MAPS_PROVIDER=osrm OSRM_BASE_URL=http://localhost:5000
```

Notes: OSRM routing here is car-profile `driving` for every
service today (bike routing on a bicycle profile is a later
tuning item, not a v1 blocker — estimates still fall back to
haversine if OSRM fails, and the response says which provider
was used). Rebuild the extract on a schedule as roads change;
budget RAM for the extract size (a province extract runs
comfortably on a few GB; a full-country extract needs more).

## Scaling notes (what is real in v1, what is later)

Real now: stateless API instances, transactional accept, Redis
OTP limiting, Redis socket adapter, ledger-derived balances,
on-read analytics (fine at pilot scale; a materialised daily
rollup is the high-volume follow-up). Later, not v1: read
replicas for analytics, partitioned `ride_locations` by month,
H3 cells for surge/heatmap only if Redis GEO becomes a
bottleneck, BullMQ workers for notifications. Do not
prematurely microservice-split the NestJS monolith — modules
are the boundary until a module's load justifies extraction.

## CI/CD (to wire up, not claimed as existing)

Suggested GitHub Actions jobs: lint → typecheck → unit tests →
integration tests → builds (api, admin-web) → dependency audit
→ Docker image build. Deploy only on green main + manual
approval for production. Rollback = previous image tag +
migration-down plan reviewed before any destructive migration
(destructive migrations are avoided; prefer
expand-then-contract). This pipeline does not exist yet in the
repo — the Phase 17 deliverable is the runbook above, not a
CI claim.

## Known limits that deployment must respect

- Postgres accept-transaction, Redis limiter, Redis socket
  adapter, S3 provider against real S3/MinIO, and Docker stack
  boot were NOT live-tested in the build VM (no Postgres, Redis,
  or Docker there). Verify all five on a staging machine before
  relying on them — the code paths are reviewed and unit/stub
  tested, but staging is the first real execution.
- Dev CORS: a non-production API enables open CORS (`main.ts`) so
  the admin web app can call it from a browser during testing.
  Production MUST replace this with an explicit origin allow-list
  before any real deployment — do not ship open CORS.
- SMS delivery is wired via Twilio (env-selected, see
  `docs/SMS-DELIVERY.md`) but NOT live-tested against Twilio's real
  API in the build VM, and no Twilio account exists yet — the
  deployer must create one and set the env vars. Without them the
  API still logs OTPs only and users cannot log in by SMS.
- Push notifications do not exist yet; SOS incidents surface in
  the admin queue, they do not page anyone.
- Flutter apps are statically checked only; first device run
  needs `flutter pub get` + `analyze` + `test` on a machine with
  the Flutter SDK.
