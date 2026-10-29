# API-SPEC.md — /api/v1

Base: `/api/v1`. Auth: `Authorization: Bearer <access JWT>` (short-lived,
15 min) + refresh-token rotation via HttpOnly cookie or secure mobile
storage (see SECURITY.md). Every response: `{ data, meta?, error? }`,
`X-Request-Id` header, consistent error shape
`{ code, message, details? }`. Pagination: `?page=&per_page=` (max 100),
cursor pagination for live lists. Idempotency: `Idempotency-Key` header
required for payments, wallet top-ups, payouts, promo redemption and
offer selection.

## Auth

- `POST /auth/request-otp` { phone } — rate-limited, returns only "sent"
  (no user-enumeration detail)
- `POST /auth/verify-otp` { phone, code, device } → access + refresh
- `POST /auth/refresh` (rotates refresh token; old token revoked)
- `POST /auth/logout` (this device), `POST /auth/logout-all`
- `POST /auth/admin/login` { email, password } (+ MFA step if enabled)
- `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`

## Users / drivers

- `GET /users/me`, `PATCH /users/me`
- `POST /drivers/register`, `GET /drivers/status`, `POST /drivers/documents`
  (signed upload URLs only), `GET /drivers/vehicles`, `POST /drivers/vehicles`
- `POST /drivers/location` (driver, batched GPS), `POST /drivers/online`,
  `POST /drivers/offline`

## Rides

- `POST /rides/estimate` { pickup, destination, service, category } →
  distance, duration, suggested fare, fare breakdown, pricing mode
- `POST /rides/request` { pickup, destination, service, category,
  customer_offer_minor?, payment_method } → request (SEARCHING/OFFERING)
- `GET /rides/:id`, `GET /rides?status=&from=&to=&city_id=`
- `GET /rides/:id/offers`, `POST /rides/:id/offers` (driver: accept/counter/decline)
- `POST /rides/:id/select-driver` { offer_id } — **atomic winner transaction**
- `POST /rides/:id/cancel` { reason }
- `POST /rides/:id/arrived`, `POST /rides/:id/verify-pin` { pin },
  `POST /rides/:id/start`, `POST /rides/:id/complete`
  (start/complete require server GPS + state checks; client completion
  alone never settles payment)
- `GET /rides/:id/timeline` (status history, permission-scoped)

## Deliveries, wallet, payments, ratings, support, safety

- `POST /deliveries`, `GET /deliveries/:id`, `POST /deliveries/:id/pickup-proof`,
  `POST /deliveries/:id/delivery-proof`
- `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/top-up`,
  `POST /wallet/withdraw` (driver payout request)
- `POST /payments/:id/confirm` (webhook-driven for gateways; cash/wallet
  settled server-side on completion)
- `POST /ratings` { ride_id, stars 1–5, comment?, report? } — once per direction
- `GET /notifications`, `POST /notifications/:id/read`
- `POST /support/tickets`, `GET /support/tickets/:id`
- `POST /safety/sos` { ride_id?, location } → high-priority incident

## Admin (all under `/admin/*`, permission-guarded per endpoint)

`/admin/dashboard`, `/admin/live-map`, `/admin/rides`, `/admin/deliveries`,
`/admin/customers`, `/admin/drivers`, `/admin/drivers/:id/approve|reject|suspend`,
`/admin/vehicles`, `/admin/kyc`, `/admin/cities`, `/admin/zones`,
`/admin/pricing`, `/admin/commissions`, `/admin/payments`, `/admin/wallets`,
`/admin/payouts`, `/admin/promotions`, `/admin/support`, `/admin/disputes`,
`/admin/safety`, `/admin/notifications`, `/admin/analytics`, `/admin/reports`,
`/admin/roles`, `/admin/administrators`, `/admin/audit-logs`, `/admin/settings`

Permission examples (granular, not role-name-only): `users.read`,
`users.suspend`, `drivers.approve`, `drivers.reject`, `rides.read`,
`rides.cancel`, `rides.assign`, `pricing.manage`, `commission.manage`,
`payments.manage`, `refunds.manage`, `cities.manage`, `admins.manage`,
`roles.manage`, `reports.read`, `audit.read`. SUPER_ADMIN holds all;
other admins hold only assigned permissions. Every admin mutation writes
an audit row.

## WebSocket events (Socket.IO, authenticated, room-scoped)

`ride.request.created`, `ride.offer.created`, `ride.offer.updated`,
`ride.offer.expired`, `ride.driver.selected`, `driver.location.updated`,
`driver.arrived`, `ride.pin.required`, `ride.started`, `ride.completed`,
`ride.cancelled`, `delivery.updated`, `safety.incident.created`,
`notification.created`. No private ride data is broadcast to a public room.

## OpenAPI

Swagger is generated from NestJS decorators in Phase 3 (`/docs` endpoint,
admin-only in production). This spec is the contract the generated docs
must match; drift between this file and Swagger is a CI failure in Phase 16.
