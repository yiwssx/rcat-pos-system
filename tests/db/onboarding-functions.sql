\set ON_ERROR_STOP on
-- Dev/CI-only function privilege tests. Transaction is rolled back.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',decode(repeat('81',32),'hex'),decode(repeat('91',32),'hex'),now()+interval '2 hours'),
 ('10000000-0000-4000-8000-000000000002',decode(repeat('82',32),'hex'),decode(repeat('92',32),'hex'),now()+interval '2 hours');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE v_tenant uuid; v_store uuid; v_invite uuid; v_result record;
        v_denied boolean:=false;
BEGIN
  BEGIN
    SELECT count(*) INTO v_store FROM rcat.stores;
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'auth role read stores directly'; END IF;

  SELECT tenant_id,store_id INTO v_tenant,v_store
  FROM rcat_private.create_merchant_for_session(
    decode(repeat('81',32),'hex'),'sql-check-shop','SQL Shop','main-shop','Main'
  );
  IF v_tenant IS NULL OR v_store IS NULL THEN
    RAISE EXCEPTION 'merchant function returned no ids';
  END IF;

  v_invite:=rcat_private.create_staff_invitation(
    decode(repeat('81',32),'hex'),v_tenant,'b@test.invalid','cashier',
    decode(repeat('83',32),'hex')
  );
  IF v_invite IS NULL THEN RAISE EXCEPTION 'no invitation id'; END IF;

  v_denied:=false;
  BEGIN
    SELECT * INTO v_result FROM rcat_private.accept_staff_invitation(
      decode(repeat('81',32),'hex'),decode(repeat('83',32),'hex')
    );
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'wrong recipient accepted invitation'; END IF;

  SELECT * INTO v_result FROM rcat_private.accept_staff_invitation(
    decode(repeat('82',32),'hex'),decode(repeat('83',32),'hex')
  );
  IF v_result.tenant_id<>v_tenant OR v_result.role<>'cashier' THEN
    RAISE EXCEPTION 'incorrect invited membership';
  END IF;
  v_denied:=false;
  BEGIN
    PERFORM rcat_private.accept_staff_invitation(
      decode(repeat('82',32),'hex'),decode(repeat('83',32),'hex')
    );
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'invite reused'; END IF;

  v_denied:=false;
  BEGIN
    PERFORM rcat_private.create_staff_invitation(
      decode(repeat('82',32),'hex'),v_tenant,'a@test.invalid','manager',
      decode(repeat('84',32),'hex')
    );
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'cashier created invitation'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: SQL tenant provisioning, role restriction, invite email binding and replay resistance'
