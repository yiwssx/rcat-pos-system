\set ON_ERROR_STOP on
-- EPHEMERAL CI ONLY. Each Store QR scan must mint its own scoped capability.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash)
VALUES('10000000-0000-4000-8000-000000000088',
       'store-qr-cashier@test.invalid','INVALID_TEST_HASH');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES('00000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000088','cashier');
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
  a uuid:='00000000-0000-4000-8000-000000000001';
  b uuid:='00000000-0000-4000-8000-000000000002';
  sa uuid:='20000000-0000-4000-8000-000000000001';
  sb uuid:='20000000-0000-4000-8000-000000000002';
  owner bytea:=decode(repeat('c1',32),'hex');
  foreign_owner bytea:=decode(repeat('c2',32),'hex');
  cashier bytea:=decode(repeat('c3',32),'hex');
  guest_a bytea:=decode(repeat('a1',32),'hex');
  guest_b bytea:=decode(repeat('a2',32),'hex');
  guest_new bytea:=decode(repeat('a3',32),'hex');
  guest_hybrid bytea:=decode(repeat('a4',32),'hex');
  guest_reopen bytea:=decode(repeat('a5',32),'hex');
  qr uuid;new_qr uuid;v jsonb;aa jsonb;bb jsonb;
  denied boolean;grand integer;
BEGIN
  -- A default Table Service store cannot issue a counter QR.
  denied:=false;
  BEGIN
    PERFORM rcat_private.rotate_store_qr(owner,a,sa);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Table-only store created Store QR'; END IF;
  v:=rcat_private.store_qr_snapshot(owner,a,sa);
  IF v->>'serviceMode'<>'table' OR v->>'publicId' IS NOT NULL THEN
    RAISE EXCEPTION 'Store QR leaked before enabling Quick Service';
  END IF;

  PERFORM rcat_private.set_store_service_mode(owner,a,sa,'quick',0);
  v:=rcat_private.rotate_store_qr(owner,a,sa);
  qr:=(v->>'publicId')::uuid;
  IF qr IS NULL THEN RAISE EXCEPTION 'Store QR missing after authorized rotation'; END IF;

  -- Public ID does not by itself grant access or turn a closed shop on.
  v:=rcat_private.open_printed_store_qr(a,sa,qr,guest_a);
  IF (v->>'open')::boolean IS DISTINCT FROM false OR v?'guestSessionId' THEN
    RAISE EXCEPTION 'Closed shop minted Store QR session';
  END IF;
  PERFORM rcat_private.set_store_ordering_enabled(owner,a,sa,true);

  -- Two different phones scan same public QR: two *different* private grants.
  aa:=rcat_private.open_printed_store_qr(a,sa,qr,guest_a);
  bb:=rcat_private.open_printed_store_qr(a,sa,qr,guest_b);
  IF NOT (aa->>'open')::boolean OR NOT (bb->>'open')::boolean
    OR aa->>'guestSessionId'=bb->>'guestSessionId'
    OR aa->>'serviceMode'<>'quick' OR bb->>'serviceMode'<>'quick'
    OR aa?'guestToken' OR bb?'guestToken'
  THEN RAISE EXCEPTION 'Store QR returned shared or unsafe guest session'; END IF;
  v:=rcat_private.resolve_store_guest_session(guest_a);
  IF v->>'guestSessionId'<>aa->>'guestSessionId'
    OR v->>'storeId'<>sa::text OR v->>'entryMode'<>'counter'
    OR v?'orders' OR v?'paymentState' OR v?'tokenDigest'
  THEN RAISE EXCEPTION 'Customer A scope failed'; END IF;
  v:=rcat_private.resolve_store_guest_session(guest_b);
  IF v->>'guestSessionId'<>bb->>'guestSessionId' THEN
    RAISE EXCEPTION 'Customer B received A session'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.resolve_store_guest_session(
      decode(repeat('ef',32),'hex'));
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Forged guest Store QR token accepted'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.open_printed_store_qr(b,sb,qr,guest_new);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant public QR accepted'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.rotate_store_qr(cashier,a,sa);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cashier rotated Store QR'; END IF;
  v:=rcat_private.store_qr_snapshot(cashier,a,sa);
  IF v->>'publicId'<>qr::text THEN
    RAISE EXCEPTION 'Authorized cashier cannot read printed QR'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.store_qr_snapshot(owner,b,sb);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant staff read Store QR'; END IF;
  v:=rcat_private.store_qr_snapshot(foreign_owner,b,sb);
  IF v->>'publicId' IS NOT NULL THEN
    RAISE EXCEPTION 'Foreign store has unexpected Store QR'; END IF;

  -- Crucial: private Store QR grant cannot pass old Table Visit APIs.
  denied:=false;
  BEGIN
    PERFORM rcat_private.resolve_ordering_visit(guest_a);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Store QR credential became Table Visit'; END IF;

  -- Rotating printed QR rejects old locators and revokes ALL old clients.
  v:=rcat_private.rotate_store_qr(owner,a,sa);
  new_qr:=(v->>'publicId')::uuid;
  IF new_qr=qr THEN RAISE EXCEPTION 'QR did not rotate'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.open_printed_store_qr(a,sa,qr,guest_new);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Old printed QR still opens'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.resolve_store_guest_session(guest_a);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Rotated QR resurrected A'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.resolve_store_guest_session(guest_b);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Rotated QR resurrected B'; END IF;
  v:=rcat_private.open_printed_store_qr(a,sa,new_qr,guest_new);
  IF NOT (v->>'open')::boolean THEN
    RAISE EXCEPTION 'Fresh QR could not issue a new grant'; END IF;

  -- Changing the service mode invalidates even unexpired grants.
  PERFORM rcat_private.set_store_service_mode(owner,a,sa,'hybrid',1);
  denied:=false;
  BEGIN
    PERFORM rcat_private.resolve_store_guest_session(guest_new);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Old mode revision remained authorized'; END IF;
  v:=rcat_private.open_printed_store_qr(a,sa,new_qr,guest_hybrid);
  IF v->>'serviceMode'<>'hybrid' THEN
    RAISE EXCEPTION 'Hybrid Store QR denied'; END IF;

  -- Closing ordering revokes session (not just hiding it); printed QR stays.
  PERFORM rcat_private.set_store_ordering_enabled(owner,a,sa,false);
  PERFORM rcat_private.set_store_ordering_enabled(owner,a,sa,true);
  denied:=false;
  BEGIN
    PERFORM rcat_private.resolve_store_guest_session(guest_hybrid);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Closed shop session survived reopen'; END IF;
  v:=rcat_private.open_printed_store_qr(a,sa,new_qr,guest_reopen);
  IF NOT (v->>'open')::boolean THEN
    RAISE EXCEPTION 'Stable QR could not reopen with a fresh session'; END IF;

  -- No client role can enumerate raw session/token digests or QR internals.
  denied:=false;
  BEGIN PERFORM 1 FROM rcat_private.store_guest_sessions;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Auth role can read guest digests'; END IF;
  denied:=false;
  BEGIN PERFORM 1 FROM rcat_private.store_public_qrs;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Auth role can enumerate raw QRs'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
  a uuid:='00000000-0000-4000-8000-000000000001';
  sa uuid:='20000000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT count(*) FROM rcat.audit_events
      WHERE tenant_id=a AND subject_id=sa AND action='store.qr.rotated')<>2
  THEN RAISE EXCEPTION 'QR rotation audit count wrong'; END IF;
  IF (SELECT count(*) FROM rcat_private.store_guest_sessions
      WHERE tenant_id=a AND store_id=sa)<>5
  THEN RAISE EXCEPTION 'Store session count wrong'; END IF;
  IF (SELECT count(*) FROM rcat_private.store_guest_sessions
      WHERE tenant_id=a AND store_id=sa AND revoked_at IS NULL)<>1
  THEN RAISE EXCEPTION 'Old grants not revoked on close'; END IF;
END $$;

SET LOCAL ROLE rcat_app;
DO $$
DECLARE denied boolean:=false;
BEGIN
  BEGIN PERFORM 1 FROM rcat_private.store_guest_sessions;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Tenant app may enumerate Store grants'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: public Store QR is independent of per-customer grants, tenant roles, rotations, closures and Table Visit checkout'
