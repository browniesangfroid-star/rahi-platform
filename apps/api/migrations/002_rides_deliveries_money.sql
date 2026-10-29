-- 002_rides_deliveries_money.sql — Phase 2, empty tables only, no seed rows.
-- Financial and audit tables are append-only: application code must never
-- UPDATE amount/actor rows here, and must never soft-delete them.

CREATE TYPE ride_status AS ENUM ('DRAFT','SEARCHING','OFFERING','DRIVER_SELECTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','WAITING_FOR_PIN','IN_PROGRESS','COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_DRIVER','CANCELLED_BY_ADMIN','NO_DRIVER_FOUND','EXPIRED');
CREATE TYPE offer_status AS ENUM ('LIVE','ACCEPTED','DECLINED','EXPIRED','SUPERSEDED');
CREATE TYPE delivery_status AS ENUM ('REQUESTED','COURIER_SELECTED','COURIER_EN_ROUTE_PICKUP','PICKED_UP','IN_TRANSIT','ARRIVED','DELIVERED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_COURIER','CANCELLED_BY_ADMIN');
CREATE TYPE payment_status AS ENUM ('PENDING','AUTHORIZED','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED');
CREATE TYPE ledger_entry_type AS ENUM ('RIDE_PAYMENT','COMMISSION','TOP_UP','WITHDRAWAL','BONUS','REFUND','ADMIN_ADJUSTMENT');

CREATE TABLE ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  city_id UUID REFERENCES cities(id),
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  category_id UUID REFERENCES vehicle_categories(id),
  pickup_geo geography(Point, 4326) NOT NULL,
  destination_geo geography(Point, 4326) NOT NULL,
  pickup_label TEXT,
  destination_label TEXT,
  suggested_fare_minor INT NOT NULL,
  customer_offer_minor INT,
  pricing_mode pricing_mode NOT NULL,
  pricing_rule_version INT,
  status ride_status NOT NULL DEFAULT 'DRAFT',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ride_requests_pickup_idx ON ride_requests USING GIST (pickup_geo);
CREATE INDEX ride_requests_live_idx ON ride_requests (status) WHERE status IN ('SEARCHING','OFFERING');

CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES ride_requests(id),
  customer_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID REFERENCES users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  status ride_status NOT NULL,
  final_fare_minor INT,
  commission_minor INT,
  commission_rule_version INT,
  payment_method TEXT CHECK (payment_method IN ('CASH','WALLET')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rides_customer_idx ON rides (customer_id, created_at DESC);
CREATE INDEX rides_driver_idx ON rides (driver_id, created_at DESC);
CREATE INDEX rides_live_idx ON rides (status) WHERE status NOT IN ('COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_DRIVER','CANCELLED_BY_ADMIN','NO_DRIVER_FOUND','EXPIRED');

CREATE TABLE ride_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES users(id),
  proposed_fare_minor INT NOT NULL,
  status offer_status NOT NULL DEFAULT 'LIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ride_offers_request_idx ON ride_offers (request_id, status);
CREATE UNIQUE INDEX one_live_offer_per_driver
  ON ride_offers (request_id, driver_id) WHERE status = 'LIVE';

CREATE TABLE ride_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  from_status ride_status,
  to_status ride_status NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_role TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ride_history_idx ON ride_status_history (ride_id, created_at);

CREATE TABLE ride_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  point geography(Point, 4326) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ride_locations_idx ON ride_locations (ride_id, recorded_at);

CREATE TABLE ride_pins (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_details (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  package_category TEXT,
  size_weight TEXT,
  notes TEXT,
  photo_storage_key TEXT,
  status delivery_status NOT NULL DEFAULT 'REQUESTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE delivery_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  proof_type TEXT NOT NULL CHECK (proof_type IN ('OTP','PHOTO','SIGNATURE')),
  storage_key TEXT,
  otp_hash TEXT,
  verified_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('CUSTOMER','DRIVER','PLATFORM','COMMISSION','BONUS')),
  owner_id UUID,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id, currency)
);
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES wallet_accounts(id),
  entry_type ledger_entry_type NOT NULL,
  amount_minor INT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  actor_id UUID REFERENCES users(id),
  reason TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_account_idx ON ledger_entries (account_id, created_at DESC);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES rides(id),
  provider TEXT NOT NULL DEFAULT 'WALLET',
  provider_reference TEXT,
  amount_minor INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  status payment_status NOT NULL DEFAULT 'PENDING',
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  before_summary JSONB,
  after_summary JSONB,
  reason TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_actor_idx ON audit_logs (actor_id, created_at DESC);
