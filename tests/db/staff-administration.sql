\set ON_ERROR_STOP on
-- Run against isolated CI PostgreSQL database ONLY.
BEGIN;
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','cashier'
);
INSERT INTO rcat_private.auth_sessions(
  user_id,token_digest,csrf_digest,expires_at
) VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('c1',32),'hex'),decode(repeat('d1',32),'hex'),now()+interval '2 hours'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('c2',32),'hex'),decode(repeat('d2',32),'hex'),now()+interval '2 hours');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE n integer; new_role text; denied boolean;
BEGIN
  SELECT count(*) INTO n
    FROM rcat_private.list_tenant_staff(
      decode(repeat('c1',32),'hex'),
      '00000000-0000-4000-8000-000000000001');
  IF n<>2 THEN RAISE EXCEPTION 'Owner cannot list two tenant members'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.list_tenant_staff(
      decode(repeat('c2',32),'hex'),
      '00000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cashier can list staff'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.manage_tenant_staff(
      decode(repeat('c2',32),'hex'),
      '00000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','change_role','manager');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cashier promoted own role'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.manage_tenant_staff(
      decode(repeat('c1',32),'hex'),
      '00000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001','remove',NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Owner removed themselves'; END IF;

  new_role:=rcat_private.manage_tenant_staff(
    decode(repeat('c1',32),'hex'),
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'change_role','kitchen');
  IF new_role<>'kitchen' THEN RAISE EXCEPTION 'Role mutation failed'; END IF;

  new_role:=rcat_private.manage_tenant_staff(
    decode(repeat('c1',32),'hex'),
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'remove',NULL);
  IF new_role<>'removed' THEN RAISE EXCEPTION 'Removal failed'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.manage_tenant_staff(
      decode(repeat('c1',32),'hex'),
      '00000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'change_role','manager');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Removed staff was reassigned'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: owner-only roster, mutation, protected owner and removed-staff checks'
