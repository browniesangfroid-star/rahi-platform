-- 006_driver_stats_dispatch_attempts.sql — Phase 7.
-- Driver stats feed the documented ranking formula (distance, rating,
-- acceptance, fairness). Dispatch attempts record every matching round
-- so declined/timeout drivers are excluded from later rounds and so
-- matching can be audited. No data seeded here.

CREATE TABLE IF NOT EXISTS driver_stats (
  driver_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trips_today INT NOT NULL DEFAULT 0,
  trips_date DATE NOT NULL DEFAULT CURRENT_DATE,
  offers_sent INT NOT NULL DEFAULT 0,
  offers_accepted INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispatch_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  radius_km NUMERIC(5,2) NOT NULL,
  score NUMERIC(6,4) NOT NULL,
  distance_km NUMERIC(8,3) NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'OFFERED' CHECK (outcome IN ('OFFERED','ACCEPTED','DECLINED','TIMEOUT','SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatch_attempts_request_idx ON dispatch_attempts (request_id, created_at);
