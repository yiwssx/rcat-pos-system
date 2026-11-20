\set ON_ERROR_STOP on
-- EPHEMERAL CI ONLY. Never run this fixture against a live store.
-- Stage B1 persists a dormant service-mode preference; ordering still uses
-- the existing Table QR flow until the guarded B2+ migration is accepted.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash)
VALUES(
  '10000000-0000-4000-8000-000000000088',
  'service-mode-cashier@test.invalid','INVALID_TEST_HASH'
);
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000088','cashier'
);
INSERT INTO rcat_private.auth_sessions(
  user_id,token_digest,csrf_digest,expires_at
) VALUES
('10000000-0000-4000-8000-000000000001',
  decode(repeat('c1',32),'hex'),decode(repeat('d1',32),'hex'),now()+interval '1 hour'),
('10000000-0000-4000-8000-000000000002',
  decode(repeat('c2',32),'hex'),decode(repeat('d2',32),'hex'),now()+interval '1 hour'),
('10000000-0000-4000-8000-000000000088',
  decode(repeat('c3',32),'hex'),decode(repeat('d3',32),'hex'),now()+interval '1 hour');

SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  tenant_a uuid:='00000000-0000-4000-8000-000000000001';
  tenant_b uuid:='00000000-0000-4000-8000-000000000002';
  store_a uuid:='20000000-0000-4000-8000-000000000001';
  store_b uuid:='20000000-0000-4000-8000-000000000002';
  owner_a bytea:=decode(repeat('c1',32),'hex');
  owner_b bytea:=decode(repeat('c2',32),'hex');
  cashier bytea:=decode(repeat('c3',32),'hex');
  result jsonb;denied boolean;
BEGIN
  result:=rcat_private.store_service_mode_snapshot(owner_a,tenant_a,store_a);
  IF result->>'serviceMode'<>'table'
    OR (result->>'revision')::bigint<>0
    OR (result->>'configured')::boolean
  THEN RAISE EXCEPTION 'New store is not default Table Service'; END IF;

  result:=rcat_private.set_store_service_mode(
    owner_a,tenant_a,store_a,'quick',0
  );
  IF result->>'serviceMode'<>'quick'
    OR (result->>'revision')::bigint<>1
    OR NOT (result->>'changed')::boolean
  THEN RAISE EXCEPTION 'First Quick preference missing'; END IF;

  result:=rcat_private.set_store_service_mode(
    owner_a,tenant_a,store_a,'quick',1
  );
  IF (result->>'revision')::bigint<>1
    OR (result->>'changed')::boolean
  THEN RAISE EXCEPTION 'No-op duplicated service revision'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.set_store_service_mode(
      owner_a,tenant_a,store_a,'hybrid',0
    );
  EXCEPTION WHEN SQLSTATE 'P0042' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Stale CAS changed service mode'; END IF;

  result:=rcat_private.set_store_service_mode(
    owner_a,tenant_a,store_a,'hybrid',1
  );
  IF result->>'serviceMode'<>'hybrid'
    OR (result->>'revision')::bigint<>2
  THEN RAISE EXCEPTION 'Hybrid preference not saved'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.set_store_service_mode(
      owner_a,tenant_a,store_a,'payments',2
    );
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Invalid service mode accepted'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.set_store_service_mode(
      cashier,tenant_a,store_a,'table',2
    );
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cashier changed mode'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.store_service_mode_snapshot(
      owner_a,tenant_b,store_b
    );
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Foreign store preference readable'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.set_store_service_mode(
      owner_a,tenant_b,store_b,'quick',0
    );
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant mode mutation accepted'; END IF;

  result:=rcat_private.store_service_mode_snapshot(owner_b,tenant_b,store_b);
  IF result->>'serviceMode'<>'table'
    OR (result->>'revision')::bigint<>0
  THEN RAISE EXCEPTION 'Tenant B preference contaminated'; END IF;

  denied:=false;
  BEGIN PERFORM 1 FROM rcat_private.store_service_modes;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Auth role can read raw service config'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
  tenant_a uuid:='00000000-0000-4000-8000-000000000001';
  store_a uuid:='20000000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT count(*) FROM rcat_private.store_service_modes
      WHERE tenant_id=tenant_a AND store_id=store_a
        AND service_mode='hybrid' AND revision=2)<>1 THEN
    RAISE EXCEPTION 'Service preference not persisted once'; END IF;
  IF (SELECT count(*) FROM rcat.audit_events
      WHERE tenant_id=tenant_a AND subject_id=store_a
        AND action='store.service_mode.changed')<>2 THEN
    RAISE EXCEPTION 'Service preference change audit mismatch'; END IF;
END $$;

SET LOCAL ROLE rcat_app;
DO $$
DECLARE denied boolean:=false;
BEGIN
  BEGIN PERFORM 1 FROM rcat_private.store_service_modes;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'App role can read private mode config'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: dormant Table default, Quick/Hybrid preference, revision CAS, audit, tenant/RBAC and private storage'
