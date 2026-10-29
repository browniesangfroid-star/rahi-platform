-- 010_support_safety.sql — Phase 14.
-- Ratings (once per direction per ride), support tickets with
-- messages, safety incidents (SOS), and signed share-trip links.
-- Share tokens are stored only as SHA-256 hashes: a database read
-- alone must never be enough to open someone's live trip.

CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id),
  rater_user_id UUID NOT NULL REFERENCES users(id),
  rater_role TEXT NOT NULL CHECK (rater_role IN ('CUSTOMER', 'DRIVER')),
  rated_user_id UUID NOT NULL REFERENCES users(id),
  stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  report_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_id, rater_role)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES rides(id),
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  category TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (category IN ('RIDE_ISSUE', 'PAYMENT', 'SAFETY', 'ACCOUNT', 'REPORT', 'OTHER')),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id),
  author_role TEXT NOT NULL CHECK (author_role IN ('CUSTOMER', 'DRIVER', 'SUPPORT')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id),
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'HIGH' CHECK (priority IN ('HIGH', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  snapshot JSONB NOT NULL,
  note TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id),
  created_by UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phase 14 permission + SUPPORT_AGENT grant (new migration, never an
-- edit to 003). SUPER_ADMIN bypasses permission checks in code, so
-- this grant matters for the dedicated support role.
INSERT INTO permissions (name) VALUES ('support.manage') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'support.manage'
WHERE r.name = 'SUPPORT_AGENT' ON CONFLICT DO NOTHING;
