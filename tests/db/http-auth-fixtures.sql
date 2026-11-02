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
 WHERE email='a@test.invalid';
