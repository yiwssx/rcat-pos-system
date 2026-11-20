\set ON_ERROR_STOP on
-- B3, ephemeral PostgreSQL test only. No host/Production/financial settlement.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash)
VALUES ('10000000-0000-4000-8000-000000000091',
        'b3-kitchen@test.invalid','INVALID_TEST_HASH');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES ('00000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000091','kitchen');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
('10000000-0000-4000-8000-000000000001',
 decode(repeat('81',32),'hex'),decode(repeat('82',32),'hex'),now()+interval '1 hour'),
('10000000-0000-4000-8000-000000000091',
 decode(repeat('83',32),'hex'),decode(repeat('84',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  tenant uuid:='00000000-0000-4000-8000-000000000001';
  store uuid:='20000000-0000-4000-8000-000000000001';
  other_tenant uuid:='00000000-0000-4000-8000-000000000002';
  other_store uuid:='20000000-0000-4000-8000-000000000002';
  owner bytea:=decode(repeat('81',32),'hex');
  kitchen bytea:=decode(repeat('83',32),'hex');
  secret_a bytea:=decode(repeat('a9',32),'hex');
  secret_b bytea:=decode(repeat('b9',32),'hex');
  secret_c bytea:=decode(repeat('c9',32),'hex');
  master_a bytea:=decode(repeat('91',32),'hex');
  master_b bytea:=decode(repeat('92',32),'hex');
  cat uuid;product uuid;table_id uuid;visit_a uuid;visit_b uuid;
  bill_a uuid;bill_b uuid;order_a uuid;order_b uuid;
  opened jsonb;second jsonb;result jsonb;snapshot jsonb;cart jsonb;
  denied boolean;
BEGIN
  PERFORM rcat_private.set_store_ordering_enabled(owner,tenant,store,true);
  cat:=rcat_private.add_menu_category(
    owner,tenant,store,'b3-life-test','B3 lifecycle');
  product:=rcat_private.add_menu_product(
    owner,tenant,store,cat,'Life test tea',4000);
  table_id:=rcat_private.create_ordering_table(
    owner,tenant,store,'B3 Cycle table');

  -- QR scan may mint a Guest grant, but NEVER a phantom Bill.
  opened:=rcat_private.open_printed_ordering_table(
    tenant,store,table_id,master_a,secret_a);
  second:=rcat_private.open_printed_ordering_table(
    tenant,store,table_id,decode(repeat('93',32),'hex'),secret_b);
  IF NOT (opened->>'open')::boolean OR NOT (second->>'open')::boolean THEN
    RAISE EXCEPTION 'Printable QR failed to issue guest visits'; END IF;
  SELECT v.id INTO visit_a FROM rcat.table_ordering_visits v
  JOIN rcat.table_guest_grants g ON g.visit_id=v.id
  WHERE g.token_digest=secret_a;
  IF visit_a IS NULL OR NOT EXISTS (
    SELECT 1 FROM rcat.table_guest_grants g
    WHERE g.visit_id=visit_a AND g.token_digest=secret_b
  ) THEN RAISE EXCEPTION 'Two phones are not sharing the same Table Visit'; END IF;
  IF EXISTS(
    SELECT 1 FROM rcat.bills b WHERE b.tenant_id=tenant
      AND b.store_id=store AND b.table_id=table_id
  ) THEN RAISE EXCEPTION 'Scanning alone created a Bill'; END IF;

  cart:=jsonb_build_object(
    'orderedBy','Guest A','deliverTo','Table B3',
    'items',jsonb_build_array(
       jsonb_build_object('productId',product,'quantity',2,
                         'optionIds','[]'::jsonb)));
  result:=rcat_private.place_guest_order_when_open(
    secret_a,'b3-owner-first-0001',cart);
  order_a:=(result->>'orderId')::uuid;
  bill_a:=(result->>'billId')::uuid;
  IF bill_a IS NULL OR (result->>'amountSatang')::bigint<>8000
    OR result->>'paymentState'<>'not_requested' OR
    (result->>'replayed')::boolean THEN
    RAISE EXCEPTION 'First guest Order did not open one operational Bill'; END IF;

  -- Same-visit, different device has a distinct Order but the SAME Bill.
  result:=rcat_private.place_guest_order_when_open(
    secret_b,'b3-other-guest-0001',
    jsonb_set(cart,'{orderedBy}','"Guest B"'::jsonb));
  order_b:=(result->>'orderId')::uuid;
  IF (result->>'billId')::uuid<>bill_a OR order_a=order_b THEN
    RAISE EXCEPTION 'Second guest incorrectly created another Bill'; END IF;

  -- Retry may not duplicate Orders or Bills.
  result:=rcat_private.place_guest_order_when_open(
    secret_a,'b3-owner-first-0001',cart);
  IF (result->>'replayed')::boolean IS DISTINCT FROM true
    OR (result->>'orderId')::uuid<>order_a THEN
    RAISE EXCEPTION 'Same-key retry was not idempotent'; END IF;

  snapshot:=rcat_private.operational_bill_snapshot(
    owner,tenant,store,bill_a,50);
  IF snapshot->>'status'<>'open'
    OR (snapshot->>'orderCount')::int<>2
    OR (snapshot->>'operationalTotalSatang')::bigint<>16000
    OR snapshot->>'creationSource'<>'guest_order'
    OR snapshot?'paid' THEN
    RAISE EXCEPTION 'Active Bill aggregation or Payment boundary failed'; END IF;

  -- A staff-initiated visit rotation may not escape an open Bill.
  denied:=false;
  BEGIN
    PERFORM rcat_private.rotate_ordering_visit(
      owner,tenant,store,table_id,master_b);
  EXCEPTION WHEN SQLSTATE 'P0043' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Open Bill allowed a new table cycle'; END IF;

  -- Staff from another tenant, or the kitchen role, may not close the Bill.
  denied:=false;
  BEGIN
    PERFORM rcat_private.close_operational_bill(
      owner,other_tenant,other_store,bill_a);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant Bill closure authorized'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.close_operational_bill(kitchen,tenant,store,bill_a);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Kitchen closed the Bill'; END IF;

  result:=rcat_private.close_operational_bill(owner,tenant,store,bill_a);
  IF result->>'status'<>'closed' OR (result->>'replayed')::boolean
    OR (result->>'paymentVerified')::boolean THEN
    RAISE EXCEPTION 'Close is not an explicit operational closure'; END IF;
  result:=rcat_private.close_operational_bill(owner,tenant,store,bill_a);
  IF (result->>'replayed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Repeated close was not a no-op'; END IF;

  -- Both old phones lose permission immediately, including an old key retry.
  FOREACH secret_a IN ARRAY ARRAY[secret_a,secret_b] LOOP
    denied:=false;
    BEGIN
      PERFORM rcat_private.resolve_ordering_visit(secret_a);
    EXCEPTION WHEN insufficient_privilege THEN denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'Old Guest could resolve closed visit'; END IF;
    denied:=false;
    BEGIN
      PERFORM rcat_private.place_guest_order_when_open(
        secret_a,'b3-denied-afterclose-0001',cart);
    EXCEPTION WHEN insufficient_privilege THEN denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'Stale Guest could checkout after close'; END IF;
  END LOOP;

  -- The SAME permanently printed Table QR now starts a NEW visit. Scanning
  -- still creates no Bill. First new Order mints it atomically.
  opened:=rcat_private.open_printed_ordering_table(
    tenant,store,table_id,master_b,secret_c);
  IF NOT (opened->>'open')::boolean THEN
    RAISE EXCEPTION 'Permanent QR failed after proper closure'; END IF;
  SELECT v.id INTO visit_b
  FROM rcat.table_ordering_visits v
  JOIN rcat.table_guest_grants g ON g.visit_id=v.id
  WHERE g.token_digest=secret_c;
  IF visit_b IS NULL OR visit_b=visit_a THEN
    RAISE EXCEPTION 'Old closed Visit reused in new Bill cycle'; END IF;
  IF (SELECT count(*) FROM rcat.bills b WHERE b.table_id=table_id)<>1 THEN
    RAISE EXCEPTION 'Fresh scan alone opened a second Bill'; END IF;

  result:=rcat_private.place_guest_order_when_open(
    secret_c,'b3-second-cycle-0001',cart);
  bill_b:=(result->>'billId')::uuid;
  IF bill_b IS NULL OR bill_a=bill_b THEN
    RAISE EXCEPTION 'New Order reused old closed Bill'; END IF;
  snapshot:=rcat_private.operational_bill_snapshot(
    owner,tenant,store,bill_b,50);
  IF snapshot->>'status'<>'open' OR
     (snapshot->>'orderCount')::int<>1 THEN
    RAISE EXCEPTION 'New Bill has foreign/old Orders'; END IF;
  snapshot:=rcat_private.operational_bill_snapshot(
    owner,tenant,store,bill_a,50);
  IF snapshot->>'status'<>'closed' OR
     (snapshot->>'orderCount')::int<>2 THEN
    RAISE EXCEPTION 'Historical Bill changed after new cycle'; END IF;

  PERFORM set_config('test.b3.bill_a',bill_a::text,true);
  PERFORM set_config('test.b3.bill_b',bill_b::text,true);
  PERFORM set_config('test.b3.visit_a',visit_a::text,true);
  PERFORM set_config('test.b3.visit_b',visit_b::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE
  a uuid:=current_setting('test.b3.bill_a')::uuid;
  b uuid:=current_setting('test.b3.bill_b')::uuid;
  old_visit uuid:=current_setting('test.b3.visit_a')::uuid;
  new_visit uuid:=current_setting('test.b3.visit_b')::uuid;
BEGIN
  IF (SELECT count(*) FROM rcat.bills WHERE id IN (a,b))<>2
   OR (SELECT count(*) FROM rcat.bills WHERE id IN (a,b)
         AND closed_at IS NULL)<>1
   OR (SELECT count(*) FROM rcat.audit_events
         WHERE action='bill.operational.auto_opened'
         AND subject_id IN (a,b))<>2
   OR (SELECT count(*) FROM rcat.audit_events
         WHERE action='bill.operational.closed'
         AND subject_id=a)<>1 THEN
     RAISE EXCEPTION 'Bill open/close audit or active uniqueness failed'; END IF;
  IF (SELECT count(*) FROM rcat.table_guest_grants g
     WHERE g.visit_id=old_visit AND g.revoked_at IS NOT NULL)<>2 THEN
     RAISE EXCEPTION 'Old table grants were not explicitly revoked'; END IF;
  IF NOT EXISTS(SELECT 1 FROM rcat.table_ordering_visits
    WHERE id=old_visit AND revoked_at IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM rcat.table_ordering_visits
    WHERE id=new_visit AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Visit revocation and new cycle missing'; END IF;
  IF (SELECT count(*) FROM rcat.orders
    WHERE visit_id IN (old_visit,new_visit) AND payment_state='not_requested')<>3
  THEN RAISE EXCEPTION 'Operational closure changed payment obligations'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: one active table Bill, two guests, audited staff close, revoked stale grants, fresh QR visit and immutable Orders'
