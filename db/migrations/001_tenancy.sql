DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rcat_app') THEN
    CREATE ROLE rcat_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA rcat;
REVOKE ALL ON SCHEMA rcat FROM PUBLIC;

CREATE TABLE rcat.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 48),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rcat.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 320),
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- rcat_app is NEVER granted direct access to global users or password hashes.
CREATE TABLE rcat.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES rcat.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner','manager','cashier','kitchen')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_memberships_user_idx ON rcat.tenant_memberships(user_id);

CREATE TABLE rcat.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES rcat.tenants(id) ON DELETE RESTRICT,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 48),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX stores_tenant_idx ON rcat.stores(tenant_id);

CREATE TABLE rcat.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES rcat.tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES rcat.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 3 AND 96),
  subject_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_time_idx ON rcat.audit_events(tenant_id,created_at DESC);

-- RLS is defense in depth, not identity verification. Only trusted API code may
-- set app.tenant_id from a verified authenticated membership, transaction-locally.
ALTER TABLE rcat.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON rcat.tenants
  FOR SELECT TO rcat_app
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE rcat.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON rcat.tenant_memberships
  FOR SELECT TO rcat_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE rcat.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.stores FORCE ROW LEVEL SECURITY;
CREATE POLICY stores_read ON rcat.stores
  FOR SELECT TO rcat_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY stores_insert ON rcat.stores
  FOR INSERT TO rcat_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY stores_update ON rcat.stores
  FOR UPDATE TO rcat_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE rcat.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON rcat.audit_events
  FOR SELECT TO rcat_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY audit_append ON rcat.audit_events
  FOR INSERT TO rcat_app
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA rcat TO rcat_app;
GRANT SELECT ON rcat.tenants, rcat.tenant_memberships TO rcat_app;
GRANT SELECT, INSERT, UPDATE ON rcat.stores TO rcat_app;
GRANT SELECT, INSERT ON rcat.audit_events TO rcat_app;
GRANT USAGE ON SEQUENCE rcat.audit_events_id_seq TO rcat_app;
COMMENT ON ROLE rcat_app IS 'Restricted application SQL role; never a DB owner or migration role';
