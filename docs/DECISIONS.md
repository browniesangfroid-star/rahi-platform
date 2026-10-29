# DECISIONS.md — assumptions and confirmations needed

## Decisions already taken (safest / most scalable reasonable choice)

1. **Brand:** "Rahi" is a working, configurable brand — not a final
   commercial trademark. Replace via `design-tokens` + `system_settings`
   before launch.
2. **Monolith-first backend:** one NestJS app with domain modules, not
   microservices on day one. Modules are the extraction boundary.
3. **Winner selection:** PostgreSQL transaction + `FOR UPDATE` row lock
   is the authority; Redis locks are only a fast-path hold, never the
   settlement authority. This avoids split-brain winners.
4. **Request vs ride split:** `ride_requests` (unmatched) and `rides`
   (matched) are separate tables so analytics on unmatched demand is clean.
5. **Money in minor units, integer maths, ledger-derived balances.**
6. **Maps/payment/SMS behind interfaces;** v1 ships CASH + WALLET only.
7. **Pilot geography:** Pakistan-first (PKR, +92 phones, Asia/Karachi
   timezone handling), but currency, language and phone format are
   configuration, not hardcoded Pakistan-only logic. i18n: English + Urdu
   files in the apps (Phase 4), other languages later.
8. **Demo mode is dev-only** and can never create real payments or KYC approvals.

## Confirmed 2026-10-28 — user tapped "Confirm the defaults and continue to Phase 2"

Interpretation recorded here so it can be corrected: the user confirmed the
*proposed defaults* below, not a specific vendor where none was proposed.
Anything still marked OPEN stays open and is built behind an interface,
so it can change without a rewrite.

- CONFIRMED: v1 payments = CASH + WALLET only. Card / JazzCash / Easypaisa /
  Stripe are Phase 12+ providers, not v1 scope.
- CONFIRMED: pricing modes for pilot = NEGOTIATION (car), FIXED (bike),
  HYBRID (delivery).
- CONFIRMED: starting commission = 15% pilot, configurable per city/service,
  driver override available.
- CONFIRMED: minimum KYC set = CNIC + driving licence + vehicle registration.
  Police verification is NOT added unless later confirmed.
- CONFIRMED: admin MFA required for ALL admins in production.
- CONFIRMED: "Rahi" as working brand (configurable, not a final trademark).
- SMS/OTP vendor: Twilio wired post-Phase-17 (env-selectable
  provider, log fallback in dev; see docs/SMS-DELIVERY.md). Local
  PK gateway remains a possible later addition. OPEN: map provider
  (dev default: OSM + OSRM, no vendor lock-in), pilot cities (USER
  DECISION 2026-10-29: launch starts from Islamabad — Islamabad city
  created live via API the same day; Lahore was only the dev default), production
  hosting (Docker-first, provider-agnostic), terms/privacy drafting owner.

## Decisions needing YOUR confirmation (they affect business model, legal or infra)

Please confirm, in one reply, as many as you can — work on Phases 3+
will pause only on the ones you leave open, and only where they block code:

1. **Payment provider for launch:** CASH + WALLET only for v1, or do you
   want JazzCash / Easypaisa / Stripe integrated in v1? (Affects Phase 12
   scope and sandbox accounts.)
2. **SMS/OTP provider:** which vendor (e.g. Twilio, Vonage, a local PK
   SMS gateway)? OTP cost and delivery in Pakistan depend on this.
3. **Map provider for launch:** Google Maps, Mapbox, or OSM + OSRM?
   (Cost, accuracy and licensing differ materially.)
4. **Pilot cities:** Lahore only, or Lahore + Karachi + Islamabad from day one?
5. **Pricing mode for pilot:** NEGOTIATION, FIXED, DYNAMIC or HYBRID per
   service? (Default proposed: NEGOTIATION for car, FIXED for bike pilot,
   HYBRID for delivery — confirm or change.)
6. **Commission starting rate:** proposed 15% pilot (configurable per
   city/service, driver override available). Confirm or set another rate.
7. **KYC documents:** CNIC + licence + vehicle registration as the
   minimum set? Any additional document (e.g. police verification) required?
8. **Production hosting:** VPS / AWS / GCP / other? (Affects DEPLOYMENT.md
   Phase 17 and backup design.)
9. **Brand & legal entity:** is "Rahi" acceptable as a working name, and
   who owns the terms/privacy policy drafting? (Legal/compliance — do not
   launch on placeholder policies.)
10. **Admin MFA:** required for all admins in production, or only
    SUPER_ADMIN / FINANCE_ADMIN? (Proposed: all admins.)

If you confirm none of these now, Phase 2–3 will proceed on the defaults
above and each decision will be revisited at its phase gate — nothing
irreversible is built on an unconfirmed choice.
