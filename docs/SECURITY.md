# SECURITY.md

## Authentication

- Phone OTP: 6-digit code, hashed (bcrypt/argon2, never plaintext),
  5-minute expiry, max 5 attempts, rate-limited per phone and per IP
  (e.g. 5 requests / 15 min, then backoff). Codes are never logged.
- Admin login: email + Argon2id password, optional TOTP MFA (required for
  SUPER_ADMIN and FINANCE_ADMIN in production). High-risk admin actions
  (payout approval, commission change, admin creation) require
  re-authentication / MFA step.
- JWT: short access token (15 min, RS256 or HS256 with a rotated secret
  from the secret manager), refresh token rotation — every refresh issues
  a new refresh token and revokes the old one; reuse of a revoked refresh
  token revokes the whole device family (token-reuse detection).
- Sessions/devices: `devices` + `sessions` tables; logout current device
  and logout-all are first-class endpoints. Suspicious new device login
  triggers a notification.
- Password reset: time-limited token, hashed, single-use, emailed to the
  registered address only. No reset link is ever sent to a different address.

## Authorisation

RBAC with granular permissions (see API-SPEC.md). Guards check permission,
not role name, on every admin endpoint. Resource ownership is checked on
every ride/delivery/wallet endpoint: a user can only read their own rides,
a driver only their own offers, an admin only cities they are scoped to
(CITY_ADMIN scope). Socket room joins re-check authorisation.

## Input, transport and storage

- DTO validation on every endpoint (class-validator / Zod in NestJS);
  parameterised queries / ORM only; no string-built SQL.
- Secure headers (Helmet), CORS allowlist, CSRF protection for
  cookie-based admin sessions, XSS protection via React escaping + CSP.
- TLS everywhere; secrets only via environment / secret manager; `.env`
  is git-ignored; `.env.example` contains placeholders only.
- Uploads: file-type allowlist, size limit, virus-scan hook point,
  storage via signed URLs only. Identity documents are never public URLs
  and never returned to unauthorised roles.
- Encryption in transit (TLS) + at rest (managed DB/volume encryption in
  production). PII fields that need it (e.g. identity numbers) are
  encrypted at application level in later phases, with key rotation noted.

## Audit and observability

- Every sensitive admin operation writes `admin_actions` + `audit_logs`
  (actor, action, target, before/after summary, reason, IP, request id).
  Audit rows are append-only.
- Structured logs with request ids. Never log: passwords, OTP values,
  tokens, full identity-document numbers, full card numbers, or raw GPS
  history beyond the trip being debugged (and then only in a secured log).
- Health: `/health` (liveness), `/health/ready` (DB + Redis + queue checks).
  Metrics endpoint for Prometheus-style scraping in production.

## Privacy

Data minimisation: collect only what a ride, payment or KYC decision needs.
Separate operational data from analytics: analytics events carry ride
aggregates and city/service, not names, phones or exact addresses.
Retention and anonymisation per BUSINESS-RULES.md. Account deletion is a
workflow (grace period → anonymise → confirm), not a button that deletes
financial history.

## Development-only credentials

Seed accounts, if any, are marked `DEV ONLY — DO NOT USE IN PRODUCTION`
in seed scripts and docs, use obviously fake data, and are disabled when
`NODE_ENV=production`. There is no universal production admin password
anywhere in this repository.
