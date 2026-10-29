-- 008_delivery_request_details_history.sql — Phase 11.
-- Delivery details are supplied at request time (so couriers see the
-- package before offering) but delivery_details references a matched
-- ride, so the request-time copy lives in its own table and is copied
-- to delivery_details at accept. Delivery status history mirrors the
-- ride-history pattern. Proof attempts are tracked for OTP lockout.

CREATE TABLE IF NOT EXISTS delivery_request_details (
  request_id UUID PRIMARY KEY REFERENCES ride_requests(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  package_category TEXT NOT NULL,
  size_weight TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  from_status delivery_status,
  to_status delivery_status NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_role TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_history_idx ON delivery_status_history (ride_id, created_at);

ALTER TABLE delivery_proofs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
