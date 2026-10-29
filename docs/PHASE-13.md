# PHASE 13 — Super Admin (done, tested)

## Objective
Give the platform an operator: someone who can open a city,
price a service, rename or switch off a service or category, and
see what actually happened — without a deploy and without editing
a database by hand.

## What was built
- Admin API (`/admin/*`, permission-guarded; SUPER_ADMIN holds all
  permissions):
  - Cities: create, list, activate/deactivate (`cities.manage`).
    Deactivating a city removes it from estimate resolution — an
    inactive city returns "service not available", it does not
    linger in results.
  - Pricing rules: create (versioned) and list (`pricing.manage`).
    Creating a rule for a city+service that already has one writes
    the next version; pricing always reads the latest, and old
    versions are never edited, so historical rides stay
    reconstructable.
  - Catalogues (`catalog.manage`): service types and vehicle
    categories (names + activation), the service→category mapping,
    and the package-category list. Service and vehicle codes are
    fixed by the database enums (migration 001), so admin
    management honestly covers names and activation — not
    inventing new codes. Deactivating a service or category blocks
    estimates for it. Defaults apply until an admin first saves a
    change, and a corrupt setting falls back to defaults rather
    than breaking estimates.
  - Audit log (`audit.read`): every admin mutation writes who,
    what, which record, and before/after summaries. The pre-existing
    driver-KYC audit stub was unified onto the same entry shape
    instead of leaving two audit formats.
  - Overview (`reports.read`): real counts — users, drivers by
    KYC status, rides and payments by status, commission balance
    (derived from the ledger), pending top-ups and withdrawals,
    cities total/active.
- Pricing wiring: estimate/request now checks service and category
  activation and the admin-managed mapping, and city resolution
  skips inactive cities. Delivery requests validate package
  category against the admin-managed list (the compiled list is
  only the default now).
- Admin web (`apps/admin-web`, Next.js): real sign-in with the
  admin login + MFA challenge flow, token in localStorage, and
  four live pages — overview, cities (create + activate/
  deactivate), pricing (list + versioned create), audit log.
  Every value comes from the API; failures are shown, never
  papered over with placeholder data. Run with
  `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1 npm run dev`.

## Verification (2026-10-28)
- [x] API tests pass 23/23, including three new admin suites:
      cities + pricing versioning + deactivation removing a city
      from estimates (and re-activation restoring it), catalog
      deactivation blocking estimates + package-category
      replacement (new category accepted, removed default
      rejected) + service-category mapping read-back, and overview
      counts. A plain phone user gets 403 on admin endpoints.
- [x] Admin web production build passes (`next build`, routes
      `/`, `/cities`, `/pricing`, `/audit`).
- [ ] Postgres admin store live-test — NOT run (same VM limit as
      Phases 3–12). Note: Postgres pricing-rule creation requires
      the service row to exist in `service_types`; the catalog
      upsert endpoint creates it, so the order is catalog first,
      pricing rule second.

## Known limits
1. No admin user management UI yet: roles are assigned through
   the existing RBAC endpoints, and admin accounts are created
   through the existing admin-user store path.
2. No per-city admin scoping in the web UI: `user_roles` carries
   `scope_city_id`, but the new endpoints do not yet enforce it
   (a scoped admin currently sees all cities).
3. No bulk import for cities or pricing rules — one record at a
   time through the API or the web forms.

## Next: Phase 14 — Support and safety (support tickets from
ratings/reports, SOS incidents, share-trip links, PIN admin reset,
and the cancellation/no-show review queue built on the reasons
recorded since Phase 10).
