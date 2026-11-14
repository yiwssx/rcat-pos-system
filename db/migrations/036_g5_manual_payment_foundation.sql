-- G5-M1 foundation only. This migration creates NO HTTP payment path,
-- no live QR exposure, no provider integration and no paid-status transition.
-- Real-money enablement remains blocked on #81 G4/G6 owner acceptance.
--
-- Only a registered PromptPay ID can be encoded. Ordinary bank account
-- numbers are NOT arbitrary PromptPay IDs.
CREATE TABLE rcat.store_promptpay_receivers (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  recipient_kind text NOT NULL
    CHECK (recipient_kind IN ('mobile','national_id')),
  recipient_identifier text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,store_id),
  FOREIGN KEY (tenant_id,store_id)
    REFERENCES rcat.stores(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT store_promptpay_identifier_valid CHECK (
    (recipient_kind='mobile' AND
      recipient_identifier ~ '^0[689][0-9]{8}$') OR
    (recipient_kind='national_id' AND
      recipient_identifier ~ '^[0-9]{13}$')
  )
);

-- Every Order has exactly zero or one logical PromptPay obligation.
-- Multiple Orders with identical receiver/amount may generate identical
-- QR payloads; a Payment Request ID is NOT a bank transfer reference.
CREATE TABLE rcat.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  amount_satang bigint NOT NULL
    CHECK (amount_satang BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'THB' CHECK (currency='THB'),
  recipient_kind text NOT NULL
    CHECK (recipient_kind IN ('mobile','national_id')),
  recipient_identifier text NOT NULL,
  state text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (state='awaiting_payment'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,store_id,order_id),
  UNIQUE (tenant_id,store_id,id),
  FOREIGN KEY (tenant_id,store_id,order_id)
    REFERENCES rcat.orders(tenant_id,store_id,id) ON DELETE RESTRICT,
  CONSTRAINT payment_request_receiver_valid CHECK (
    (recipient_kind='mobile' AND
      recipient_identifier ~ '^0[689][0-9]{8}$') OR
    (recipient_kind='national_id' AND
      recipient_identifier ~ '^[0-9]{13}$')
  )
);
CREATE INDEX payment_requests_store_created_idx
  ON rcat.payment_requests(tenant_id,store_id,created_at DESC);

-- Fail closed: no policy and no table grants for runtime roles. Future
-- narrowly-authorized SECURITY DEFINER procedures must own all access,
-- audit receiver changes, enforce owner/manager, tracking capability,
-- amount snapshots, idempotency and manual decision races.
ALTER TABLE rcat.store_promptpay_receivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.store_promptpay_receivers FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.payment_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rcat.store_promptpay_receivers, rcat.payment_requests
  FROM PUBLIC,rcat_app,rcat_auth;
