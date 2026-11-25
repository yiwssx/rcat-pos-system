\set ON_ERROR_STOP on
-- Synthetic private PNG (API validates raster/CRC separately).
-- This transaction rolls back all payment evidence and simulated bank refs.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
  decode(repeat('d1',32),'hex'),decode(repeat('d2',32),'hex'),
  now()+interval '1 hour'),
('10000000-0000-4000-8000-000000000002',
  decode(repeat('d3',32),'hex'),decode(repeat('d4',32),'hex'),
  now()+interval '1 hour');
INSERT INTO rcat.users(id,email,password_hash)
VALUES ('10000000-0000-4000-8000-000000000003',
 'g5-slip-cashier@test.invalid','TEST_HASH_NO_LOGIN');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role)
VALUES ('00000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000003','cashier');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000003',
  decode(repeat('d5',32),'hex'),decode(repeat('d6',32),'hex'),
  now()+interval '1 hour');

SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('d1',32),'hex');
 visit bytea:=decode(repeat('d7',32),'hex');
 token1 bytea:=decode(repeat('d8',32),'hex');
 token2 bytea:=decode(repeat('d9',32),'hex');
 category uuid; product uuid; table_id uuid; order1 uuid; order2 uuid;
 cart jsonb; response jsonb;
BEGIN
 category:=rcat_private.add_menu_category(owner,tenant,store,
    'g5-slip-catalog','G5 slip catalog');
 product:=rcat_private.add_menu_product(owner,tenant,store,category,
    'Mock smoothie',18900);
 table_id:=rcat_private.create_ordering_table(owner,tenant,store,'G5 slip table');
 PERFORM rcat_private.rotate_ordering_visit(owner,tenant,store,table_id,visit);
 cart:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
    'productId',product,'quantity',1,'optionIds','[]'::jsonb)));
 response:=rcat_private.place_guest_order(
   visit,'g5-slip-order-key-0001',cart);
 order1:=(response->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
   order1,visit,'g5-slip-order-key-0001',token1);
 response:=rcat_private.place_guest_order(
   visit,'g5-slip-order-key-0002',cart);
 order2:=(response->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
   order2,visit,'g5-slip-order-key-0002',token2);
 PERFORM rcat_private.set_merchant_promptpay_receiver(
   owner,tenant,store,'mobile','0812345678',0);
 PERFORM set_config('test.g5.slip.order1',order1::text,true);
 PERFORM set_config('test.g5.slip.order2',order2::text,true);
END $$;
RESET ROLE;
UPDATE rcat.store_promptpay_receivers SET enabled=true
WHERE tenant_id='00000000-0000-4000-8000-000000000001'
 AND store_id='20000000-0000-4000-8000-000000000001';

SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('d1',32),'hex');
 other bytea:=decode(repeat('d3',32),'hex');
 cashier bytea:=decode(repeat('d5',32),'hex');
 token1 bytea:=decode(repeat('d8',32),'hex');
 token2 bytea:=decode(repeat('d9',32),'hex');
 o1 uuid:=current_setting('test.g5.slip.order1')::uuid;
 o2 uuid:=current_setting('test.g5.slip.order2')::uuid;
 png1 bytea:=decode('89504e470d0a1a0a','hex')||decode(repeat('11',128),'hex');
 png2 bytea:=decode('89504e470d0a1a0a','hex')||decode(repeat('22',128),'hex');
 png3 bytea:=decode('89504e470d0a1a0a','hex')||decode(repeat('33',128),'hex');
 a jsonb;b jsonb;slip1 uuid;slip2 uuid;slip3 uuid; denied boolean;
BEGIN
 PERFORM rcat_private.guest_order_payment_request(o1,token1,true);
 PERFORM rcat_private.guest_order_payment_request(o2,token2,true);
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_submit_payment_slip(o1,token2,
     png1,sha256(png1),true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Wrong Order token uploaded evidence'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_submit_payment_slip(o1,token1,
     png1,sha256(png1),false);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Release-off slip upload was allowed'; END IF;

 a:=rcat_private.guest_submit_payment_slip(
   o1,token1,png1,sha256(png1),true);
 slip1:=(a->>'slipId')::uuid;
 IF a->>'state'<>'submitted' OR a->>'replayed'<>'false' THEN
   RAISE EXCEPTION 'Slip not submitted';
 END IF;
 b:=rcat_private.guest_submit_payment_slip(
   o1,token1,png1,sha256(png1),true);
 IF (b->>'slipId')::uuid<>slip1 OR b->>'replayed'<>'true' THEN
   RAISE EXCEPTION 'Duplicate upload was not idempotent';
 END IF;
 IF (rcat_private.guest_order_status(o1,token1)->>'paymentState')<>'slip_submitted'
  THEN RAISE EXCEPTION 'Slip state not reflected in guest Order'; END IF;
 IF (rcat_private.guest_order_payment_request(o1,token1,true)->>'available')<>'false'
  THEN RAISE EXCEPTION 'Slip waiting review still exposed payment QR'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_submit_payment_slip(
     o2,token2,png1,sha256(png1),true);
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Same slip reused for another Order'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_submit_payment_slip(
     o1,token1,png2,sha256(png2),true);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unreviewed slip replaced silently'; END IF;
 a:=rcat_private.merchant_payment_review_queue(owner,tenant,store,25);
 IF jsonb_array_length(a->'items')<>1 THEN
   RAISE EXCEPTION 'Merchant review inbox count mismatch';
 END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_payment_review_queue(other,tenant,store,25);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross tenant read Payment queue'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_payment_slip_png(cashier,tenant,store,slip1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cashier read private evidence'; END IF;
 IF (SELECT count(*) FROM rcat_private.merchant_payment_slip_png(
   owner,tenant,store,slip1))<>1 THEN
   RAISE EXCEPTION 'Owner cannot see scoped evidence';
 END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_payment_slip_decision(
    owner,tenant,store,slip1,1,'confirm',
    decode(repeat('ee',32),'hex'),18901,true);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Incorrect bank amount was accepted'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_payment_slip_decision(
    cashier,tenant,store,slip1,1,'reject',NULL,NULL,false);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cashier could decide Payment'; END IF;
 a:=rcat_private.merchant_payment_slip_decision(
   owner,tenant,store,slip1,1,'reject',NULL,NULL,false);
 IF a->>'paymentState'<>'awaiting_payment' THEN
   RAISE EXCEPTION 'Rejected evidence did not reopen debt'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_payment_slip_decision(
    owner,tenant,store,slip1,1,'reject',NULL,NULL,false);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Review conflict not enforced'; END IF;

 b:=rcat_private.guest_submit_payment_slip(
   o1,token1,png2,sha256(png2),true);
 slip2:=(b->>'slipId')::uuid;
 a:=rcat_private.merchant_payment_slip_decision(
   owner,tenant,store,slip2,1,'confirm',
   decode(repeat('ee',32),'hex'),18900,true);
 IF a->>'state'<>'manual_confirmed' THEN
   RAISE EXCEPTION 'Merchant confirmation failed'; END IF;
 IF (rcat_private.guest_order_status(o1,token1)->>'paymentState')<>'manual_confirmed'
   THEN RAISE EXCEPTION 'Paid state not reflected to guest'; END IF;
 IF (rcat_private.guest_order_payment_request(o1,token1,true)->>'available')<>'false'
   THEN RAISE EXCEPTION 'Confirmed Order still has payable QR'; END IF;
 -- The kitchen must remain independently operable after confirmation.
 PERFORM rcat_private.transition_merchant_order(owner,tenant,store,
   o1,'submitted','accepted');
 PERFORM rcat_private.transition_merchant_order(owner,tenant,store,
   o1,'accepted','preparing');
 IF (rcat_private.guest_order_status(o1,token1)->>'status')<>'preparing'
   THEN RAISE EXCEPTION 'Kitchen was gated by Payment'; END IF;
 b:=rcat_private.guest_submit_payment_slip(
   o2,token2,png3,sha256(png3),true);
 slip3:=(b->>'slipId')::uuid;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_payment_slip_decision(
    owner,tenant,store,slip3,1,'confirm',
    decode(repeat('ee',32),'hex'),18900,true);
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Bank reference double-counted'; END IF;
 denied:=false;
 BEGIN
   PERFORM count(*) FROM rcat.payment_slip_evidence;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Direct evidence table exposed'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.audit_events
  WHERE action='payment.slip.manual_confirmed'
    AND subject_id=current_setting('test.g5.slip.order1')::uuid)<>1 THEN
   RAISE EXCEPTION 'Confirmation audit missing';
 END IF;
 IF (SELECT count(*) FROM rcat.payment_slip_evidence
  WHERE order_id=current_setting('test.g5.slip.order1')::uuid
    AND state='manual_confirmed')<>1 THEN
   RAISE EXCEPTION 'Duplicate or missing payment confirmation';
 END IF;
END $$;
-- Retention is a separate explicit store policy; no migration-time purge.
DO $$
DECLARE
  t uuid:='00000000-0000-4000-8000-000000000001';
  s uuid:='20000000-0000-4000-8000-000000000001';
  denied boolean:=false;
BEGIN
  BEGIN
    PERFORM rcat_private.purge_expired_payment_slip_images(t,s,100);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Unapproved retention allowed'; END IF;
END $$;
UPDATE rcat.store_promptpay_receivers SET slip_image_retention_days=90
  WHERE tenant_id='00000000-0000-4000-8000-000000000001'
    AND store_id='20000000-0000-4000-8000-000000000001';
UPDATE rcat.payment_slip_evidence SET submitted_at=now()-interval '91 days'
  WHERE order_id IN (current_setting('test.g5.slip.order1')::uuid,
                     current_setting('test.g5.slip.order2')::uuid)
    AND state IN ('manual_confirmed','submitted');
CREATE TEMP TABLE slip_retention_before ON COMMIT DROP AS
  SELECT id,tenant_id,store_id,request_id,order_id,sha256,state,revision,
    submitted_at,reviewed_at,reviewed_by,bank_reference_digest,
    confirmed_amount_satang
  FROM rcat.payment_slip_evidence
  WHERE order_id IN (current_setting('test.g5.slip.order1')::uuid,
                     current_setting('test.g5.slip.order2')::uuid);
SELECT set_config('test.g5.expired.pending',id::text,true)
  FROM rcat.payment_slip_evidence
  WHERE order_id=current_setting('test.g5.slip.order2')::uuid
    AND state='submitted';
SELECT set_config('test.g5.fresh.rejected',id::text,true)
  FROM rcat.payment_slip_evidence
  WHERE order_id=current_setting('test.g5.slip.order1')::uuid
    AND state='rejected';
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  t uuid:='00000000-0000-4000-8000-000000000001';
  s uuid:='20000000-0000-4000-8000-000000000001';
  owner bytea:=decode(repeat('d1',32),'hex');
  expired uuid:=current_setting('test.g5.expired.pending')::uuid;
  fresh uuid:=current_setting('test.g5.fresh.rejected')::uuid;
  q jsonb;
  denied boolean:=false;
BEGIN
  IF EXISTS (SELECT 1 FROM rcat_private.merchant_payment_slip_png(
    owner,t,s,expired)) THEN
    RAISE EXCEPTION 'Expired image still accessible before purge';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rcat_private.merchant_payment_slip_png(
    owner,t,s,fresh)) THEN
    RAISE EXCEPTION 'Unexpired image unavailable';
  END IF;
  q:=rcat_private.merchant_payment_review_queue(owner,t,s,25);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q->'items') item
    WHERE item->>'slipId'=expired::text AND item->>'imageAvailable'='false'
      AND item->>'state'='submitted') THEN
    RAISE EXCEPTION 'Expired pending review disappeared or exposed image';
  END IF;
  BEGIN
    PERFORM rcat_private.purge_expired_payment_slip_images(t,s,1);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Runtime role can purge images'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
  t uuid:='00000000-0000-4000-8000-000000000001';
  s uuid:='20000000-0000-4000-8000-000000000001';
BEGIN
  IF rcat_private.purge_expired_payment_slip_images(t,s,1)<>1 THEN
    RAISE EXCEPTION 'First bounded purge mismatch';
  END IF;
  IF rcat_private.purge_expired_payment_slip_images(t,s,1)<>1 THEN
    RAISE EXCEPTION 'Second bounded purge mismatch';
  END IF;
  IF rcat_private.purge_expired_payment_slip_images(t,s,100)<>0 THEN
    RAISE EXCEPTION 'Purge retry not idempotent';
  END IF;
  IF (SELECT count(*) FROM rcat.payment_slip_evidence
      WHERE order_id IN (current_setting('test.g5.slip.order1')::uuid,
                         current_setting('test.g5.slip.order2')::uuid)
        AND png IS NULL AND image_purged_at IS NOT NULL)<>2
    OR NOT EXISTS (SELECT 1 FROM rcat.payment_slip_evidence
      WHERE id=current_setting('test.g5.fresh.rejected')::uuid
        AND png IS NOT NULL AND image_purged_at IS NULL) THEN
    RAISE EXCEPTION 'Purge removed wrong payload or missed expired payload';
  END IF;
  IF EXISTS (SELECT * FROM slip_retention_before EXCEPT
    SELECT id,tenant_id,store_id,request_id,order_id,sha256,state,revision,
      submitted_at,reviewed_at,reviewed_by,bank_reference_digest,
      confirmed_amount_satang
    FROM rcat.payment_slip_evidence) THEN
    RAISE EXCEPTION 'Financial evidence or replay identity changed';
  END IF;
  IF (SELECT payment_state FROM rcat.orders
    WHERE id=current_setting('test.g5.slip.order1')::uuid)<>'manual_confirmed'
    OR (SELECT payment_state FROM rcat.orders
    WHERE id=current_setting('test.g5.slip.order2')::uuid)<>'slip_submitted' THEN
    RAISE EXCEPTION 'Retention changed payment status';
  END IF;
  IF (SELECT count(*) FROM rcat.audit_events
    WHERE tenant_id=t AND subject_id=s
      AND action='payment.slip.images_expired')<>2 THEN
    RAISE EXCEPTION 'Retention audit missing';
  END IF;
END $$;
ROLLBACK;
\echo 'PASS: private G5 slip intake, tenant RBAC, replay, CAS, bank check and kitchen independence'
