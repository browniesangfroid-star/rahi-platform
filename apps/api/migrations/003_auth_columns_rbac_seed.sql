-- 003_auth_columns_rbac_seed.sql — Phase 3.
-- Auth columns only; NO user accounts are seeded here. An admin account is
-- created by a separate, local-only seed script in Phase 3+ (never in prod).
-- MFA secret note: stored as TEXT in Phase 3; encrypt at rest before
-- production MFA rollout (Phase 16 hardening, see PHASE-3.md).

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

-- RBAC definitions (roles + permissions). No user is assigned here.
INSERT INTO roles (name) VALUES
  ('CUSTOMER'), ('DRIVER'), ('COURIER'), ('DISPATCHER'), ('SUPPORT_AGENT'),
  ('FINANCE_ADMIN'), ('OPERATIONS_ADMIN'), ('CITY_ADMIN'), ('SUPER_ADMIN')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (name) VALUES
  ('users.read'), ('users.suspend'), ('drivers.approve'), ('drivers.reject'),
  ('rides.read'), ('rides.cancel'), ('rides.assign'), ('pricing.manage'),
  ('commission.manage'), ('payments.manage'), ('refunds.manage'),
  ('cities.manage'), ('admins.manage'), ('roles.manage'), ('reports.read'), ('audit.read')
ON CONFLICT (name) DO NOTHING;

-- SUPER_ADMIN gets every permission.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- Sensible starter grants (adjust via /admin/roles, never by editing this file after prod):
-- OPERATIONS_ADMIN: rides + drivers + cities read/manage (no money, no admins)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN
  ('users.read','drivers.approve','drivers.reject','rides.read','rides.cancel','rides.assign','cities.manage','reports.read')
WHERE r.name = 'OPERATIONS_ADMIN' ON CONFLICT DO NOTHING;

-- FINANCE_ADMIN: money only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN
  ('payments.manage','refunds.manage','commission.manage','reports.read','users.read')
WHERE r.name = 'FINANCE_ADMIN' ON CONFLICT DO NOTHING;

-- SUPPORT_AGENT: read + support scope (tickets land in Phase 14)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('users.read','rides.read','reports.read')
WHERE r.name = 'SUPPORT_AGENT' ON CONFLICT DO NOTHING;
