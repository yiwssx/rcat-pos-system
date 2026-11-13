\set ON_ERROR_STOP on
-- EPHEMERAL DATABASE TEST ONLY: destructive predictable fixtures; never execute on production.
INSERT INTO rcat.tenants (id,slug,display_name) VALUES
 ('00000000-0000-4000-8000-000000000001','test-tenant-a','Tenant A'),
 ('00000000-0000-4000-8000-000000000002','test-tenant-b','Tenant B');
INSERT INTO rcat.users(id,email,password_hash) VALUES
 ('10000000-0000-4000-8000-000000000001','a@test.invalid','INVALID_TEST_HASH'),
 ('10000000-0000-4000-8000-000000000002','b@test.invalid','INVALID_TEST_HASH');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner');
-- The legacy CI Order fixture explicitly opts in, while newly created real
-- stores default to closed until their owner opens QR ordering.
INSERT INTO rcat.stores(id,tenant_id,slug,display_name,ordering_enabled) VALUES
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','store-a','Store A',true),
 ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','store-b','Store B',true);

BEGIN;
SET LOCAL ROLE rcat_app;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.stores) != 0 THEN
   RAISE EXCEPTION 'FAIL: no tenant context leaked stores';
 END IF;
 IF (SELECT count(*) FROM rcat.tenant_memberships) != 0 THEN
   RAISE EXCEPTION 'FAIL: no tenant context leaked memberships';
 END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE
 denied boolean := false;
 n integer;
BEGIN
 IF (SELECT count(*) FROM rcat.stores) != 1 THEN RAISE EXCEPTION 'FAIL: tenant A store isolation'; END IF;
 IF (SELECT slug FROM rcat.stores LIMIT 1) != 'store-a' THEN RAISE EXCEPTION 'FAIL: wrong store'; END IF;
 IF (SELECT count(*) FROM rcat.tenants) != 1 THEN RAISE EXCEPTION 'FAIL: tenant A identity isolation'; END IF;
 IF (SELECT count(*) FROM rcat.tenant_memberships) != 1 THEN RAISE EXCEPTION 'FAIL: tenant A membership isolation'; END IF;

 UPDATE rcat.stores SET display_name='BREACH'
 WHERE id='20000000-0000-4000-8000-000000000002';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n != 0 THEN RAISE EXCEPTION 'FAIL: cross-tenant update'; END IF;

 BEGIN
  INSERT INTO rcat.stores(tenant_id,slug,display_name)
  VALUES('00000000-0000-4000-8000-000000000002','breach-store','Forbidden');
 EXCEPTION WHEN insufficient_privilege THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL: cross-tenant insertion allowed'; END IF;

 denied := false;
 BEGIN
  SELECT count(*) INTO n FROM rcat.users;
 EXCEPTION WHEN insufficient_privilege THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL: user credentials visible to app role'; END IF;

 INSERT INTO rcat.audit_events(tenant_id,action,metadata)
 VALUES('00000000-0000-4000-8000-000000000001','tenant.test','{"ok":true}');
 IF (SELECT count(*) FROM rcat.audit_events) != 1 THEN RAISE EXCEPTION 'FAIL: audit append'; END IF;
 denied := false;
 BEGIN DELETE FROM rcat.audit_events; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL: audit deletion allowed'; END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.stores) != 1 THEN RAISE EXCEPTION 'FAIL: tenant B store isolation'; END IF;
 IF (SELECT slug FROM rcat.stores LIMIT 1) != 'store-b' THEN RAISE EXCEPTION 'FAIL: tenant B sees tenant A'; END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rcat_app;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.stores) != 0 THEN RAISE EXCEPTION 'FAIL: context leaked across transactions'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: PostgreSQL RLS cross-tenant isolation, write rejection, audit append-only and role privilege tests'
