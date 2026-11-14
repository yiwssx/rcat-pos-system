\set ON_ERROR_STOP on
-- Human readable numbers: one store, consecutive committed Orders, retry-safe.
-- Synthetic-only transaction. No Payment, bank or Production changes.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
  decode(repeat('c1',32),'hex'),decode(repeat('c2',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
 actor bytea:=decode(repeat('c1',32),'hex');
 visit bytea:=decode(repeat('c3',32),'hex');
 token1 bytea:=decode(repeat('c4',32),'hex');
 token2 bytea:=decode(repeat('c5',32),'hex');
 cat uuid; product uuid; table_id uuid; o1 uuid; o2 uuid;
 first_number bigint; second_number bigint;
 cart jsonb; a jsonb; b jsonb; inbox jsonb; lookup jsonb;
BEGIN
 cat:=rcat_private.add_menu_category(actor,tenant,store,
   'short-order-numbers','Short Order fixture');
 product:=rcat_private.add_menu_product(actor,tenant,store,cat,
   'Short-number test milk',6500);
 table_id:=rcat_private.create_ordering_table(actor,tenant,store,
   'Short Order test table');
 PERFORM rcat_private.rotate_ordering_visit(
   actor,tenant,store,table_id,visit);
 PERFORM rcat_private.set_store_ordering_enabled(
   actor,tenant,store,true);
 cart:=jsonb_build_object(
   'orderedBy','ทดสอบ','deliverTo','โต๊ะทดลอง',
   'items',jsonb_build_array(jsonb_build_object(
     'productId',product,'quantity',1,'optionIds','[]'::jsonb,'note',''
   ))
 );
 a:=rcat_private.place_guest_order_when_open(
   visit,'order-public-number-key-00001',cart);
 o1:=(a->>'orderId')::uuid;
 first_number:=(a->>'displayNumber')::bigint;
 IF first_number<1 OR a->>'paymentState'<>'not_requested' THEN
   RAISE EXCEPTION 'First Order lacks nonsecret public number';
 END IF;
 PERFORM rcat_private.bind_guest_order_tracking(
   o1,visit,'order-public-number-key-00001',token1);
 b:=rcat_private.place_guest_order_when_open(
   visit,'order-public-number-key-00001',cart);
 IF (b->>'replayed')::boolean IS DISTINCT FROM true
   OR b->>'displayNumber'<>a->>'displayNumber'
   OR b->>'orderId'<>a->>'orderId' THEN
   RAISE EXCEPTION 'Idempotent checkout changed public Order number';
 END IF;
 a:=rcat_private.place_guest_order_when_open(
   visit,'order-public-number-key-00002',cart);
 o2:=(a->>'orderId')::uuid;
 second_number:=(a->>'displayNumber')::bigint;
 PERFORM rcat_private.bind_guest_order_tracking(
   o2,visit,'order-public-number-key-00002',token2);
 IF second_number<>first_number+1 THEN
   RAISE EXCEPTION 'Retry consumed a number or numbering is not sequential';
 END IF;
 IF (rcat_private.guest_order_status(o1,token1)->>'displayNumber')::bigint
    <>first_number THEN
   RAISE EXCEPTION 'Guest tracking lost public number';
 END IF;
 IF (rcat_private.guest_order_history(o1,token1)->>'displayNumber')::bigint
    <>first_number THEN
   RAISE EXCEPTION 'Guest history lost public number';
 END IF;
 inbox:=rcat_private.merchant_order_inbox_page(
   actor,tenant,store,NULL,25,NULL,NULL);
 IF (SELECT count(*) FROM jsonb_array_elements(inbox->'orders') row_data
      WHERE row_data->>'orderId'=o2::text
        AND row_data->>'displayNumber'=second_number::text)<>1 THEN
   RAISE EXCEPTION 'Merchant Board number is incorrect';
 END IF;
 lookup:=rcat_private.merchant_order_lookup_ids(
   actor,tenant,store,ARRAY[o1,o2]);
 IF (SELECT count(*) FROM jsonb_array_elements(lookup->'orders') row_data
   WHERE row_data->>'displayNumber' IN (
     first_number::text,second_number::text
   ))<>2 THEN
   RAISE EXCEPTION 'Merchant reconnect lost public numbers';
 END IF;
 PERFORM set_config('test.shortorder.o1',o1::text,true);
 PERFORM set_config('test.shortorder.o2',o2::text,true);
END $$;
RESET ROLE;
DO $$
DECLARE o1 uuid:=current_setting('test.shortorder.o1')::uuid;
        o2 uuid:=current_setting('test.shortorder.o2')::uuid;
BEGIN
 IF (SELECT count(*) FROM rcat.orders WHERE id IN (o1,o2)
       AND display_number IS NOT NULL)=2 AND
    (SELECT count(DISTINCT display_number) FROM rcat.orders
       WHERE id IN (o1,o2))=2 THEN
   NULL;
 ELSE RAISE EXCEPTION 'Durable Order numbering missing or repeated'; END IF;
 IF (SELECT count(*) FROM rcat.store_order_counters c
     JOIN rcat.orders o ON o.store_id=c.store_id
       AND o.tenant_id=c.tenant_id
     WHERE o.id=o2 AND c.last_number>=o.display_number)<>1 THEN
   RAISE EXCEPTION 'Store counter not transactionally consistent';
 END IF;
END $$;
ROLLBACK;
\echo 'PASS: stable store-local numbers, checkout replay, tracking and merchant inbox'
