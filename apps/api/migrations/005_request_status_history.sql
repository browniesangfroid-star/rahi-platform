-- 005_request_status_history.sql — Phase 6.
-- Correction to the Phase 0 design: ride_status_history references rides
-- (post-match), but SEARCHING/OFFERING happen before a ride exists.
-- Request transitions therefore get their own history table, with the
-- same actor/reason discipline. No data is seeded here.

CREATE TABLE IF NOT EXISTS request_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  from_status ride_status,
  to_status ride_status NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_role TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_history_idx ON request_status_history (request_id, created_at);

-- ride_requests needs the fields Phase 6 actually writes.
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS category_code TEXT;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS final_offer_minor INT;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS distance_km NUMERIC(8,3);
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS duration_min INT;
