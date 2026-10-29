-- 004_driver_documents_history.sql — Phase 5.
-- Document files themselves are stored by the API (private storage, never
-- public URLs); only the storage key + mime type are recorded here.

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS bank_account TEXT;

CREATE TABLE IF NOT EXISTS driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('CNIC','LICENCE','VEHICLE_REGISTRATION','VEHICLE_PHOTO','PROFILE_PHOTO')),
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expires_at DATE,
  review_status kyc_status NOT NULL DEFAULT 'SUBMITTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_documents_user_idx ON driver_documents (driver_user_id, document_type);

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expires_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS driver_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status kyc_status,
  to_status kyc_status NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_role TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_history_user_idx ON driver_status_history (driver_user_id, created_at);
