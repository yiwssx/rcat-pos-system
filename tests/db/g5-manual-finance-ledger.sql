\set ON_ERROR_STOP on
-- Isolated synthetic ledger; no banking or real customer data.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('f1',32),'hex'),decode(repeat('f2',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('f3',32),'hex'),decode(repeat('f4',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  tenant uuid:='00000000-0000-4000-8000-000000000001';
  store uuid:='20000000-0000-4000-8000-000000000001';
  owner bytea:=decode(repeat('f1',32),'hex');
  token1 bytea:=decode(repeat('f5',32),'hex');
  token2 bytea:=decode(repeat('f6',32),'hex');
  visit bytea:=decode(repeat('f7',32),'hex');
  category uuid;product uuid;table_id uuid;o1 uuid;o2 uuid;
  cart jsonb;reply jsonb;
BEGIN
 category:=rcat_private.add_menu_category(owner,tenant,store,
  'g5-finance','Synthetic manual ledger');
 product:=rcat_private.add_menu_product(owner,tenant,store,category,'Test tea',18900);
 table_id:=rcat_private.create_ordering_table(owner,tenant,store,'G5 finance mock');
 PERFORM rcat_private.rotate_ordering_visit(owner,tenant,store,table_id,visit);
 cart:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
  'productId',product,'quantity',1,'optionIds','[]'::jsonb)));
 reply:=rcat_private.place_guest_order(visit,'g5-finance-order-key-0001',cart);
 o1:=(reply->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
  o1,visit,'g5-finance-order-key-0001',token1);
 reply:=rcat_private.place_guest_order(visit,'g5-finance-order-key-0002',cart);
 o2:=(reply->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
  o2,visit,'g5-finance-order-key-0002',token2);
 PERFORM rcat_private.set_merchant_promptpay_receiver(
  owner,tenant,store,'mobile','0812345678',0);
 PERFORM set_config('test.g5.finance.o1',o1::text,true);
 PERFORM set_config('test.g5.finance.o2',o2::text,true);
END $$;
RESET ROLE;
-- Migration-owner only fixture; no runtime method enabling a recipient.
UPDATE rcat.store_promptpay_receivers SET enabled=true
 WHERE tenant_id='00000000-0000-4000-8000-000000000001'
   AND store_id='20000000-0000-4000-8000-000000000001';
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('f1',32),'hex');
 other bytea:=decode(repeat('f3',32),'hex');
 token1 bytea:=decode(repeat('f5',32),'hex');
 o1 uuid:=current_setting('test.g5.finance.o1')::uuid;
 o2 uuid:=current_setting('test.g5.finance.o2')::uuid;
 png bytea:=decode('89504e470d0a1a0a','hex')||decode(repeat('77',128),'hex');
 a jsonb;b jsonb;s uuid;r1 uuid;r2 uuid;e uuid;denied boolean;
BEGIN
 PERFORM rcat_private.guest_order_payment_request(o1,token1,true);
 a:=rcat_private.guest_submit_payment_slip(o1,token1,png,sha256(png),true);
 s:=(a->>'slipId')::uuid;
 PERFORM rcat_private.merchant_payment_slip_decision(
  owner,tenant,store,s,1,'confirm',decode(repeat('aa',32),'hex'),18900,true);
 -- Disabled write flag cannot post alleged refunds or exceptions.
 denied:=false;
 BEGIN
   PERFORM rcat_private.request_manual_payment_refund(
    owner,tenant,store,o1,5000,'Customer return',false);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Release gate allowed refund request'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.open_manual_payment_exception(
    owner,tenant,store,NULL,'unmatched_transfer',100,'Test entry',false);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Release gate allowed exception'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.request_manual_payment_refund(
    owner,tenant,store,o2,5000,'Never paid',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Refund on unpaid Order allowed'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.request_manual_payment_refund(
    other,tenant,store,o1,5000,'Cross tenant',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross tenant refund allowed'; END IF;

 a:=rcat_private.request_manual_payment_refund(
  owner,tenant,store,o1,10000,'Partial meal return',true);
 r1:=(a->>'refundId')::uuid;
 b:=rcat_private.request_manual_payment_refund(
  owner,tenant,store,o1,8900,'Remaining drink return',true);
 r2:=(b->>'refundId')::uuid;
 denied:=false;
 BEGIN
   PERFORM rcat_private.request_manual_payment_refund(
    owner,tenant,store,o1,1,'Over reserve',true);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Refund over received amount allowed'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.decide_manual_payment_refund(
    owner,tenant,store,r1,1,'record',decode(repeat('ba',32),'hex'),
    9999,true,true);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Refund amount mismatch accepted'; END IF;
 a:=rcat_private.decide_manual_payment_refund(
    owner,tenant,store,r1,1,'record',decode(repeat('ba',32),'hex'),
    10000,true,true);
 IF a->>'state'<>'manually_recorded' THEN
    RAISE EXCEPTION 'External manual refund was not recorded'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.decide_manual_payment_refund(
    owner,tenant,store,r1,1,'void',NULL,NULL,false,true);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Refund replay ignored revision'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.decide_manual_payment_refund(
    owner,tenant,store,r2,1,'record',decode(repeat('ba',32),'hex'),
    8900,true,true);
 EXCEPTION WHEN unique_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Same bank refund reference reused'; END IF;
 PERFORM rcat_private.decide_manual_payment_refund(
   owner,tenant,store,r2,1,'void',NULL,NULL,false,true);

 a:=rcat_private.open_manual_payment_exception(
  owner,tenant,store,o1,'cancelled_after_transfer',18900,
  'Confirmed transfer, external refund pending',true);
 e:=(a->>'exceptionId')::uuid;
 denied:=false;
 BEGIN
   PERFORM rcat_private.open_manual_payment_exception(
    owner,tenant,store,'11111111-1111-4111-8111-111111111111',
    'underpayment',300,'Wrong order store',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Arbitrary Order accepted in exception'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.resolve_manual_payment_exception(
    other,tenant,store,e,1,'Wrong tenant',true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross tenant exception resolved'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.resolve_manual_payment_exception(
    owner,tenant,store,e,1,'Release off',false);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Release-off resolve succeeded'; END IF;
 PERFORM rcat_private.resolve_manual_payment_exception(
  owner,tenant,store,e,1,
  'Refund outflow independently checked by staff',true);
 denied:=false;
 BEGIN
   PERFORM rcat_private.resolve_manual_payment_exception(
    owner,tenant,store,e,1,'Replay resolution',true);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Resolution CAS missing'; END IF;
 PERFORM rcat_private.open_manual_payment_exception(
  owner,tenant,store,NULL,'unmatched_transfer',350,
  'Unmatched synthetic bank deposit',true);

 a:=rcat_private.merchant_manual_payment_report(owner,tenant,store,30);
 IF a->>'verification'<>'merchant_manual_only' OR
  (a->'summary'->>'orderCount')::integer<>2 OR
  (a->'summary'->>'outstandingOrderCount')::integer<>1 OR
  a->'summary'->>'manualReceiptSatang'<>'18900' OR
  a->'summary'->>'manualRefundRecordedSatang'<>'10000' OR
  a->'summary'->>'manualRefundPendingSatang'<>'0' OR
  (a->'summary'->>'openExceptionCount')::integer<>1 OR
  jsonb_array_length(a->'refunds')<>2 OR
  jsonb_array_length(a->'outstandingOrders')<>1 THEN
    RAISE EXCEPTION 'Manual finance report mislabeled money: %', a; END IF;
 -- Payment/stock/kitchen are never rewritten by refunds/exceptions.
 IF (rcat_private.guest_order_status(o1,token1)->>'paymentState')<>'manual_confirmed' THEN
   RAISE EXCEPTION 'Refund incorrectly mutated Payment status'; END IF;
 PERFORM rcat_private.transition_merchant_order(
   owner,tenant,store,o1,'submitted','cancelled');
 a:=rcat_private.merchant_manual_payment_report(owner,tenant,store,30);
 IF (a->'summary'->>'cancelledConfirmedCount')::integer<>1 THEN
    RAISE EXCEPTION 'Cancelled paid Order not flagged'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_manual_payment_report(other,tenant,store,30);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross tenant report readable'; END IF;
 denied:=false;
 BEGIN
   PERFORM count(*) FROM rcat.manual_payment_refunds;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Raw refund ledger readable'; END IF;
 denied:=false;
 BEGIN
   PERFORM count(*) FROM rcat.manual_payment_exceptions;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Raw exception ledger readable'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: manual refund ceiling/replay/duplicate-bank proof, exceptions and finance report RBAC'
