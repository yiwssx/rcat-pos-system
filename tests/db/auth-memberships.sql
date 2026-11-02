\set ON_ERROR_STOP on
-- Test fixtures inserted by tests/db/tenant-isolation.sql; ephemeral database ONLY.
BEGIN;
SET LOCAL ROLE rcat_auth;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.tenant_memberships) <> 0 THEN
   RAISE EXCEPTION 'RLS failure: auth role read memberships with no identity';
 END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_auth;
SELECT set_config('app.auth_user_id','10000000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.tenant_memberships) <> 1 THEN
   RAISE EXCEPTION 'RLS failure: auth role sees wrong membership count';
 END IF;
 IF (SELECT tenant_id FROM rcat.tenant_memberships LIMIT 1) <>
     '00000000-0000-4000-8000-000000000001'::uuid THEN
   RAISE EXCEPTION 'RLS failure: auth role read another user membership';
 END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_auth;
SELECT set_config('app.auth_user_id','10000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT tenant_id FROM rcat.tenant_memberships LIMIT 1) <>
     '00000000-0000-4000-8000-000000000002'::uuid THEN
   RAISE EXCEPTION 'RLS failure: other user's membership leaked';
 END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_auth;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.tenant_memberships) <> 0 THEN
   RAISE EXCEPTION 'RLS failure: auth user context leaked after rollback';
 END IF;
END $$;
ROLLBACK;
\echo 'PASS: restricted auth-role membership lookup and transaction context reset'
