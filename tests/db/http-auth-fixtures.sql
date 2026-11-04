-- EPHEMERAL CI DATABASE ONLY: do not execute on a real user database.
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='rcat_auth_ci') THEN
    CREATE ROLE rcat_auth_ci LOGIN PASSWORD 'ci-auth-only' NOINHERIT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='rcat_app_ci') THEN
    CREATE ROLE rcat_app_ci LOGIN PASSWORD 'ci-tenant-only' NOINHERIT;
  END IF;
END $$;
GRANT rcat_auth TO rcat_auth_ci;
GRANT rcat_app TO rcat_app_ci;

UPDATE rcat.users
   SET password_hash='scrypt$32768$BwcHBwcHBwcHBwcHBwcHBw$GPh5l7ryvsz3moUXdclMZoCce85CsHXDH4d5S8oADf8'
 WHERE email IN ('a@test.invalid','b@test.invalid');

-- Ephemeral Workspace account for Google OAuth HTTP integration only.
-- No real personal data or Google credentials are seeded.
INSERT INTO rcat.users(id,email,password_hash,is_active)
VALUES(
  '10000000-0000-4000-8000-000000000045',
  'staff@rcat.ac.th',
  'scrypt$32768$BwcHBwcHBwcHBwcHBwcHBw$GPh5l7ryvsz3moUXdclMZoCce85CsHXDH4d5S8oADf8',
  true
) ON CONFLICT(email) DO NOTHING;
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000045','manager')
ON CONFLICT(tenant_id,user_id) DO NOTHING;
