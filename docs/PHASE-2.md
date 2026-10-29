# PHASE 2 — Monorepo & Infrastructure (done as scaffold + static checks)

## Objective
Turn the Phase 0/1 architecture into a real, installable monorepo with a
Docker dev stack, empty-table migrations and app shells — without faking
auth, rides, payments or live data.

## Files created / changed
- Root: `package.json` (npm workspaces), `tsconfig.base.json`, `.nvmrc`
  (Node 22), `.gitignore`, `.github/workflows/ci.yml`
- `packages/shared-types`: tsconfig + `node --test` state-machine tests
- `packages/design-tokens/tokens.json`, `packages/config` (placeholder, Phase 3)
- `apps/api`: NestJS shell — `main.ts` (prefix `/api/v1`), `app.module.ts`,
  `health/health.controller.ts` (`/health` live, `/health/ready` honestly
  reports DB/Redis checks as not-implemented), `Dockerfile`
- `apps/admin-web`: Next.js shell — layout + honest scaffold page, rewrite
  to the API, `Dockerfile` (standalone output)
- `apps/customer-mobile`, `apps/driver-mobile`: Flutter pubspec + main.dart
  scaffold pages stating their real phase (4 / 5). No booking UI yet.
- `infrastructure/docker/docker-compose.yml`: postgres (PostGIS) + redis +
  minio + `api` + `admin-web` (profile `app`) + `infrastructure/nginx/nginx.conf`
- `apps/api/migrations/001_core_identity_geo.sql`,
  `002_rides_deliveries_money.sql` — empty tables only, no seed/demo rows.
  Dev seeds, when added, are a separate opt-in step, never part of schema.
- `scripts/run-migrations.sh` (psql, in-order, fails on error)
- `docs/DECISIONS.md`: defaults confirmed 2026-10-28 recorded

## Confirmed defaults applied (see DECISIONS.md for the full record)
Cash + wallet only in v1; car = NEGOTIATION, bike = FIXED, delivery =
HYBRID; 15% pilot commission; KYC = CNIC + licence + registration;
MFA for all admins in production; Rahi as working brand. Still open and
interface-only: SMS vendor, map provider (dev default OSM+OSRM), pilot
cities (dev default Lahore-first single city), hosting, terms/privacy owner.

## Verification (this run, 2026-10-28)
- [x] JSON files parse; compose YAML parses (services: postgres, redis,
      minio, api, admin-web)
- [x] Shared-types state-machine tests pass (3/3)
- [x] `npm install` succeeded (213 packages, Node 24 / npm 10.9.4)
- [x] API build passes (`tsc`), shared-types typecheck passes
- [x] Admin-web build passes (Next.js 16.4.3, route `/` static)
- [x] API server actually ran: `GET /api/v1/health` → `{"status":"ok"}`;
      `/health/ready` honestly returns `not-ready` (DB/Redis checks are
      Phase 3+ work, not faked)
- [ ] Docker stack boot + migrations against a live Postgres — NOT run
      here (no Docker/Postgres in this VM). This is the first step on a
      dev machine with Docker: see "Next step" below.

## Next step (on a machine with Docker)
```bash
cd ride-hailing-platform
npm install
docker compose -f infrastructure/docker/docker-compose.yml --profile app up -d --build
curl http://localhost:3001/api/v1/health
DATABASE_URL=postgres://rahi:change-me-dev-only@localhost:5432/rahi bash scripts/run-migrations.sh
```
Then Phase 3: auth + RBAC (OTP, JWT rotation, permissions, guards).
