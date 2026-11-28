\set ON_ERROR_STOP on
-- G5-M1: Order bearer + per-store release gate, exact-price snapshot,
-- idempotent request and independent kitchen state. Synthetic-only fixtures.
-- All modifications are rolled back. This is NOT a banking test.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
 decode(repeat('e1',32),'hex'),decode(repeat('e2',32),'hex'),
 now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('e1',32),'hex');
 visit bytea:=decode(repeat('e3',32),'hex');
 token1 bytea:=decode(repeat('e4',32),'hex');
 token2 bytea:=decode(repeat('e5',32),'hex');
 category uuid; product uuid; table_id uuid; order1 uuid; order2 uuid;
 cart jsonb; response jsonb; denied boolean;
BEGIN
 category:=rcat_private.add_menu_category(
   owner,tenant,store,'g5-order-request','G5 test catalog');
 product:=rcat_private.add_menu_product(
   owner,tenant,store,category,'Mock coffee',14905);
 table_id:=rcat_private.create_ordering_table(
   owner,tenant,store,'G5 mock table');
 PERFORM rcat_private.rotate_ordering_visit(
   owner,tenant,store,table_id,visit);
 cart:=jsonb_build_object(
   'items',jsonb_build_array(jsonb_build_object(
     'productId',product,'quantity',2,'optionIds','[]'::jsonb))
 );
 response:=rcat_private.place_guest_order(
   visit,'g5-guest-order-key001',cart);
 order1:=(response->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
   order1,visit,'g5-guest-order-key001',token1);
 response:=rcat_private.place_guest_order(
   visit,'g5-guest-order-key002',cart);
 order2:=(response->>'orderId')::uuid;
 PERFORM rcat_private.bind_guest_order_tracking(
   order2,visit,'g5-guest-order-key002',token2);

 -- Off flag MUST validate bearer but cannot create a payable request.
 response:=rcat_private.guest_order_payment_request(order1,token1,false);
 IF (response->>'available')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Disabled global Payment gate returned a payable QR';
 END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_order_payment_request(order2,token1,false);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN
   RAISE EXCEPTION 'Wrong Order tracking token accepted when Payment off';
 END IF;
 response:=rcat_private.guest_order_payment_request(order1,token1,true);
 IF (response->>'available')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Unconfigured store returned payable request';
 END IF;
 PERFORM rcat_private.set_merchant_promptpay_receiver(
   owner,tenant,store,'mobile','0812345678',0);
 response:=rcat_private.guest_order_payment_request(order1,token1,true);
 IF (response->>'available')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Configured but disabled store returned payable request';
 END IF;

 PERFORM set_config('test.g5.order1',order1::text,true);
 PERFORM set_config('test.g5.order2',order2::text,true);
 PERFORM set_config('test.g5.tenant',tenant::text,true);
 PERFORM set_config('test.g5.store',store::text,true);
END $$;
RESET ROLE;
-- Database migration owner/CI ONLY, never an application or Merchant path.
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.payment_requests)<>0 THEN
   RAISE EXCEPTION 'Disabled Payment still inserted request';
 END IF;
 UPDATE rcat.store_promptpay_receivers SET enabled=true
 WHERE tenant_id=current_setting('test.g5.tenant')::uuid
   AND store_id=current_setting('test.g5.store')::uuid;
END $$;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:=current_setting('test.g5.tenant')::uuid;
 store uuid:=current_setting('test.g5.store')::uuid;
 order1 uuid:=current_setting('test.g5.order1')::uuid;
 order2 uuid:=current_setting('test.g5.order2')::uuid;
 owner bytea:=decode(repeat('e1',32),'hex');
 token1 bytea:=decode(repeat('e4',32),'hex');
 token2 bytea:=decode(repeat('e5',32),'hex');
 response jsonb; replay jsonb; req_id uuid; denied boolean;
 claim1 bytea:=decode(repeat('a1',32),'hex');
 access1 bytea:=decode(repeat('a2',32),'hex');
 claim2 bytea:=decode(repeat('a3',32),'hex');
 access2 bytea:=decode(repeat('a4',32),'hex');
BEGIN
 -- Existing Orders from before payment activation can receive an independent
 -- capability, but issuing/redeeming does not itself create a payment request.
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_issue_order_payment_recovery(
     owner,tenant,store,order1,'not_requested',29810,true,claim1,false);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Release-off recovery issued'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_issue_order_payment_recovery(
     owner,tenant,store,order1,'not_requested',29811,true,claim1,true);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale amount admitted'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.merchant_issue_order_payment_recovery(
     owner,tenant,store,order1,'not_requested',29810,false,claim1,true);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Review was not required'; END IF;
 PERFORM rcat_private.merchant_issue_order_payment_recovery(
   owner,tenant,store,order1,'not_requested',29810,true,claim1,true);
 response:=rcat_private.guest_redeem_order_payment_recovery(order1,claim1,access1);
 replay:=rcat_private.guest_redeem_order_payment_recovery(order1,claim1,access1);
 IF response IS DISTINCT FROM replay THEN RAISE EXCEPTION 'Same-browser retry failed'; END IF;
 response:=rcat_private.guest_order_status(order1,access1);
 IF response->>'paymentState'<>'not_requested' THEN
   RAISE EXCEPTION 'Recovery changed payment state'; END IF;
 IF (rcat_private.guest_order_history(order1,access1)->>'orderId')::uuid<>order1 THEN
   RAISE EXCEPTION 'Wrong recovery timeline'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_redeem_order_payment_recovery(order1,claim1,access2);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Second browser redeemed used claim'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_order_status(order2,access1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Recovered capability read other Order'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_redeem_order_payment_recovery(order2,claim1,access2);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Claim opened wrong Order'; END IF;
 PERFORM rcat_private.merchant_issue_order_payment_recovery(
   owner,tenant,store,order1,'not_requested',29810,true,claim2,true);
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_order_status(order1,access1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Reissue preserved old recovery'; END IF;
 PERFORM rcat_private.guest_order_status(order1,token1);
 PERFORM rcat_private.guest_redeem_order_payment_recovery(order1,claim2,access2);
 response:=rcat_private.guest_order_payment_request(order1,access2,true);
 req_id:=(response->>'requestId')::uuid;
 IF req_id IS NULL OR (response->>'amountSatang')::bigint<>29810 THEN
   RAISE EXCEPTION 'Recovered order cannot pay old amount'; END IF;
 replay:=rcat_private.guest_order_payment_request(order1,token1,true);
 IF replay->>'requestId'<>req_id::text THEN RAISE EXCEPTION 'Recovery duplicated payment request'; END IF;
 PERFORM rcat_private.merchant_revoke_order_payment_recovery(owner,tenant,store,order1);
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_order_payment_request(order1,access2,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Revoked bearer still payable'; END IF;
 PERFORM rcat_private.guest_order_status(order1,token1);
 denied:=false;
 BEGIN
   PERFORM count(*) FROM rcat_private.order_payment_recovery;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Runtime read recovery table'; END IF;

 response:=rcat_private.guest_order_payment_request(order1,token1,true);
 IF (response->>'available')::boolean IS DISTINCT FROM true OR
    (response->>'amountSatang')::bigint<>29810 OR
    response->>'receiverKind'<>'mobile' OR
    response->>'receiverId'<>'0812345678' OR
    response->>'currency'<>'THB' OR
    response->>'state'<>'awaiting_payment' THEN
   RAISE EXCEPTION 'Wrong Order amount, receiver or status in QR request';
 END IF;
 req_id:=(response->>'requestId')::uuid;
 replay:=rcat_private.guest_order_payment_request(order1,token1,true);
 IF (replay->>'requestId')::uuid<>req_id THEN
   RAISE EXCEPTION 'Retry created different logical Payment Request';
 END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_order_payment_request(order1,token2,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN
   RAISE EXCEPTION 'Cross-Order token obtained payment data';
 END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_order_payment_request(
     '11111111-1111-4111-8111-111111111111',token1,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN
   RAISE EXCEPTION 'Nonexistent Order obtained payment data';
 END IF;
 denied:=false;
 BEGIN
   PERFORM count(*) FROM rcat.payment_requests;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN
   RAISE EXCEPTION 'Runtime SQL role can read payment request table';
 END IF;

 -- The kitchen remains independent of Payment: it can move to preparation
 -- while the payment still awaits transfer/verification.
 PERFORM rcat_private.transition_merchant_order(
   owner,tenant,store,order1,'submitted','accepted');
 PERFORM rcat_private.transition_merchant_order(
   owner,tenant,store,order1,'accepted','preparing');
 IF (rcat_private.guest_order_status(order1,token1)->>'status')<>'preparing'
   OR (rcat_private.guest_order_status(order1,token1)->>'paymentState')<>'awaiting_payment' THEN
   RAISE EXCEPTION 'Kitchen was gated by unpaid Payment';
 END IF;

 -- Changing recipient immediately disables payment QR access but does NOT
 -- rewrite already-created Payment Request snapshots.
 PERFORM rcat_private.set_merchant_promptpay_receiver(
   owner,tenant,store,'mobile','0898765432',1);
 replay:=rcat_private.guest_order_payment_request(order1,token1,true);
 IF (replay->>'available')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Receiver edit did not shut off Payment';
 END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.payment_requests
     WHERE tenant_id=current_setting('test.g5.tenant')::uuid
       AND store_id=current_setting('test.g5.store')::uuid
       AND order_id=current_setting('test.g5.order1')::uuid
       AND recipient_identifier='0812345678')<>1 THEN
   RAISE EXCEPTION 'Receiver edit rewrote original Payment snapshot';
 END IF;
 UPDATE rcat.store_promptpay_receivers SET enabled=true
 WHERE tenant_id=current_setting('test.g5.tenant')::uuid
   AND store_id=current_setting('test.g5.store')::uuid;
END $$;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 order1 uuid:=current_setting('test.g5.order1')::uuid;
 order2 uuid:=current_setting('test.g5.order2')::uuid;
 token1 bytea:=decode(repeat('e4',32),'hex');
 token2 bytea:=decode(repeat('e5',32),'hex');
 a jsonb; b jsonb;
BEGIN
 a:=rcat_private.guest_order_payment_request(order1,token1,true);
 b:=rcat_private.guest_order_payment_request(order2,token2,true);
 -- The old recipient is retained only inside the immutable DB request;
 -- after a receiver rotation and re-enable it must NOT reappear as a payable QR.
 IF (a->>'available')::boolean IS DISTINCT FROM false OR
    (b->>'available')::boolean IS DISTINCT FROM true OR
    b->>'receiverId'<>'0898765432' THEN
   RAISE EXCEPTION 'Stale receiving ID reappeared after receiver rotation';
 END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.payment_requests
     WHERE tenant_id=current_setting('test.g5.tenant')::uuid
       AND store_id=current_setting('test.g5.store')::uuid)<>2 THEN
   RAISE EXCEPTION 'Exactly one request per Order was not retained';
 END IF;
END $$;
-- G6: Quick ownership feeds the existing Order-only payment contract.
-- No real recipient, live transfer, or payment flag is enabled outside this
-- rolled-back test. Creating tracking alone must not freeze add-ons.
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 t uuid:=current_setting('test.g5.tenant')::uuid;
 s uuid:=current_setting('test.g5.store')::uuid;
 owner bytea:=decode(repeat('e1',32),'hex');
 a bytea:=decode(repeat('91',32),'hex');
 b bytea:=decode(repeat('92',32),'hex');
 track bytea:=decode(repeat('93',32),'hex');
 other_track bytea:=decode(repeat('94',32),'hex');
 qr uuid;cat uuid;product uuid;oid uuid;cart jsonb;v jsonb;pay jsonb;denied boolean;
BEGIN
 PERFORM rcat_private.set_store_service_mode(owner,t,s,'quick',0);
 PERFORM rcat_private.set_store_ordering_enabled(owner,t,s,true);
 qr:=(rcat_private.rotate_store_qr(owner,t,s)->>'publicId')::uuid;
 PERFORM rcat_private.open_printed_store_qr(t,s,qr,a);
 PERFORM rcat_private.open_printed_store_qr(t,s,qr,b);
 cat:=rcat_private.add_menu_category(owner,t,s,'g6-quick-pay','Counter');
 product:=rcat_private.add_menu_product(owner,t,s,cat,'Synthetic counter item',6500);
 cart:=jsonb_build_object('orderedBy','CI','deliverTo','Counter',
   'items',jsonb_build_array(jsonb_build_object('productId',product,
     'quantity',1,'optionIds','[]'::jsonb)));
 v:=rcat_private.quick_order_submit(a,'g6-quick-first-00001',cart,NULL);
 oid:=(v->>'orderId')::uuid;
 PERFORM rcat_private.bind_quick_order_tracking(oid,a,track);
 PERFORM rcat_private.bind_quick_order_tracking(oid,a,track);
 denied:=false;
 BEGIN
   PERFORM rcat_private.bind_quick_order_tracking(oid,b,other_track);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Sibling counter session claimed payment bearer'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.bind_quick_order_tracking(oid,a,other_track);
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Tracking bearer overwritten'; END IF;
 pay:=rcat_private.guest_order_payment_request(oid,track,false);
 IF pay->>'available'<>'false' THEN
   RAISE EXCEPTION 'Disabled counter payment request available'; END IF;
 v:=rcat_private.quick_order_submit(a,'g6-quick-append-0001',cart,oid);
 IF v->>'action'<>'appended' OR v->>'amountSatang'<>'13000' THEN
   RAISE EXCEPTION 'Tracking or disabled payment froze Quick append'; END IF;
 pay:=rcat_private.guest_order_payment_request(oid,track,true);
 IF pay->>'available'<>'true' OR pay->>'amountSatang'<>'13000' THEN
   RAISE EXCEPTION 'Synthetic dual-gate Quick Payment amount mismatch'; END IF;
 v:=rcat_private.quick_order_submit(a,'g6-quick-afterpay-01',cart,oid);
 IF v->>'action'<>'new_after_cutoff' OR v->>'orderId'=oid::text THEN
   RAISE EXCEPTION 'Existing payment snapshot was modified by Quick add-on'; END IF;
 IF rcat_private.guest_order_payment_request(oid,track,true)->>'requestId'
      <>pay->>'requestId'
   OR rcat_private.guest_order_status(oid,track)->>'amountSatang'<>'13000'
   OR rcat_private.guest_order_status(oid,track)->>'paymentState'<>'awaiting_payment'
 THEN RAISE EXCEPTION 'Original payable snapshot changed or falsely confirmed'; END IF;
 PERFORM rcat_private.rotate_store_qr(owner,t,s);
 denied:=false;
 BEGIN
   PERFORM rcat_private.bind_quick_order_tracking(oid,a,track);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Revoked Store grant reissued tracking'; END IF;
 IF rcat_private.guest_order_status(oid,track)->>'orderId'<>oid::text THEN
   RAISE EXCEPTION 'Order-only tracking lost after Store QR rotation'; END IF;
END $$;
RESET ROLE;

-- Expiration is enforced by the database, not by a browser timer.
RESET ROLE;
DO $$
DECLARE
 o1 uuid:=current_setting('test.g5.order1')::uuid;
 t uuid:=current_setting('test.g5.tenant')::uuid;
 s uuid:=current_setting('test.g5.store')::uuid;
 moment timestamptz:=clock_timestamp()-interval '13 hours';
BEGIN
 INSERT INTO rcat_private.order_payment_recovery(
   order_id,tenant_id,store_id,amount_satang,claim_digest,issued_at,claim_expires_at,
   access_digest,redeemed_at,access_expires_at)
 VALUES(o1,t,s,29810,decode(repeat('a7',32),'hex'),moment,
   moment+interval '30 minutes',decode(repeat('a8',32),'hex'),moment,
   moment+interval '12 hours');
END $$;
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE o1 uuid:=current_setting('test.g5.order1')::uuid; denied boolean:=false;
BEGIN
 BEGIN
   PERFORM rcat_private.guest_order_status(o1,decode(repeat('a8',32),'hex'));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Expired recovered bearer accepted'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_redeem_order_payment_recovery(o1,
     decode(repeat('a7',32),'hex'),decode(repeat('a8',32),'hex'));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Expired claim accepted'; END IF;
 PERFORM rcat_private.guest_order_status(o1,decode(repeat('e4',32),'hex'));
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: Quick Order ownership and existing gated Payment snapshot freeze'
\echo 'PASS: dual-gate PromptPay request, Order token, satang, idempotency and independent kitchen'
