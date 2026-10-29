-- 009_wallet_topups_withdrawals_refunds.sql — Phase 12.
-- Wallet accounts, ledger entries, payments and commission rules
-- already exist (migration 002 / 001). This migration adds the
-- request/approval records around them, refund records, and the
-- booking fee stored on the request at creation time (commission is
-- calculated on fare excluding booking fee, per BUSINESS-RULES.md).

ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS booking_fee_minor INT;

CREATE TABLE IF NOT EXISTS wallet_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  owner_type TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (owner_type IN ('CUSTOMER','DRIVER')),
  amount_minor INT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reference TEXT,
  reviewed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount_minor INT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  payout_reference TEXT,
  reviewed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ride_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  ride_id UUID NOT NULL REFERENCES rides(id),
  amount_minor INT NOT NULL CHECK (amount_minor > 0),
  commission_reversed_minor INT NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
