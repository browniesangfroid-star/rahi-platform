# Rahi — Ride, Bike & Delivery Platform

**Working brand, original and configurable.** Rahi (Urdu: traveller) is a production-oriented,
monorepo platform for car rides, bike rides and parcel delivery, with a negotiation
marketplace and an automatic-pricing mode. It is inspired only by publicly observable
business concepts used by ride-hailing platforms in general. It does not copy proprietary
source code, private APIs, copyrighted UI or trademarks.

> Status: **Phases 0–17 complete — the platform build is finished (API tests 41/41; shared-types tests 3/3; admin web builds; demo simulator verified; Flutter compile not run here; real SMS via Twilio wired (env-gated, not yet live-tested against Twilio).**
> Before production: verify on staging what this VM cannot run —
> Docker stack boot, Postgres accept transaction, Redis limiter +
> socket adapter, S3 against real S3/MinIO, create-admin against
> real Postgres, and a Flutter device run (see `docs/PHASE-17.md`
> and `docs/DEPLOYMENT.md`).
> This is not yet a runnable commercial product. See `docs/DECISIONS.md` for open
> decisions that need your confirmation before Phase 3+ work (payment provider,
> SMS/OTP provider, map provider, production hosting).

## What is built so far

- Phase 0 research and architecture (`docs/`)
- Monorepo skeleton, Docker Compose dev stack, `.env.example` placeholders only
- Shared TypeScript types and pure, tested-in-principle state machines for rides
  and deliveries in `packages/shared-types/`
- API skeleton structure in `apps/api/` (health endpoint contract, module map)

## Quick start (development infrastructure only)

```bash
cp infrastructure/docker/.env.example .env   # placeholders only, never real secrets
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis minio
# API / mobile / admin apps are scaffolded in Phase 1; see docs/DEPLOYMENT.md
```

## Repository layout

```
/apps
  /customer-mobile   Flutter, Android-first, iOS-capable
  /driver-mobile     Flutter, Android-first, iOS-capable
  /admin-web         Next.js + TypeScript, desktop-first
  /api               NestJS + TypeScript
/packages
  /shared-types      Ride/delivery states, roles, permissions, events
  /api-client        Typed client (Phase 3)
  /validation        DTO schemas (Phase 3)
  /design-tokens     Colours, type, spacing, radius (Phase 4)
  /config            Shared config (Phase 2)
/infrastructure
  /docker            Compose, Dockerfiles, init SQL
  /nginx             Reverse-proxy config (Phase 17)
  /deployment        Prod notes, CI (Phase 17)
/docs                Architecture, DB, API, security, testing, business rules
/scripts             Migrations, seeds, demo simulator (later phases)
```

## Core principles

1. **Server is the source of truth.** The client never calculates fare, commission,
   completion or rating eligibility. It only displays server values.
2. **One winner, by transaction.** Offer selection uses a DB transaction + row lock
   (`SELECT ... FOR UPDATE`) so two drivers cannot win the same request.
3. **Money is a ledger, never an editable balance.** Wallet balances are derived
   from immutable `ledger_entries`.
4. **States are a machine, not strings.** Illegal transitions are rejected by the
   server and recorded in history tables.
5. **Privacy by design.** Full plates, documents and exact GPS history are
   permission-gated, retention-limited and never in public URLs.
6. **Provider abstraction.** Maps, payments, SMS and push sit behind interfaces
   (`MapsProvider`, `PaymentProvider`, `SmsProvider`, `PushProvider`).

## Documentation

- `docs/RESEARCH.md` — public sources, concepts borrowed, licences to verify
- `docs/ARCHITECTURE.md` — system diagram, modules, dispatch, realtime
- `docs/DATABASE.md` — entities, indexes, PostGIS/Redis design, ER overview
- `docs/API-SPEC.md` — versioned REST + WebSocket events
- `docs/BUSINESS-RULES.md` — pricing, commission precedence, cancellation, ratings
- `docs/SECURITY.md` — auth, RBAC, audit, privacy, retention
- `docs/TESTING.md` — test plan, including the 10 concurrency tests
- `docs/DEPLOYMENT.md` — Docker, CI, observability, environments
- `docs/DECISIONS.md` — assumptions and decisions needing confirmation

## Development-only seeds

Seed credentials, when added in Phase 2, will live only in local seed scripts,
be clearly marked unsafe for production, and will never be a hardcoded
production admin password. No seed is included in this Phase 0/1 delivery.
