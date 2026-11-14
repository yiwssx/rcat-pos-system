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
BEGIN
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
 IF a->>'receiverId'<>'0812345678' OR
    b->>'receiverId'<>'0898765432' OR
    (a->>'requestId')::uuid=(b->>'requestId')::uuid THEN
   RAISE EXCEPTION 'Store receiver snapshot or per-Order isolation broken';
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
ROLLBACK;
\echo 'PASS: dual-gate PromptPay request, Order token, satang, idempotency and independent kitchen'
