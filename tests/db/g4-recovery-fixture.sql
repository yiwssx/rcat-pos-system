\set ON_ERROR_STOP on
-- CI-only committed fixture used for real pg_dump/pg_restore qualification.
-- NEVER run on a shared Staging or Production database.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  decode(repeat('f1',32),'hex'), decode(repeat('f2',32),'hex'),
  now() + interval '2 hours'
);
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  v_session bytea := decode(repeat('f1',32),'hex');
  v_tenant uuid := '00000000-0000-4000-8000-000000000001';
  v_store uuid := '20000000-0000-4000-8000-000000000001';
  v_category uuid;
  v_product uuid;
  v_table uuid;
  v_visit bytea := decode(repeat('f3',32),'hex');
  v_order uuid;
  v_cart jsonb;
  v_feed jsonb;
BEGIN
  v_category := rcat_private.add_menu_category(
    v_session,v_tenant,v_store,'g4-recovery-food','Recovery QA');
  v_product := rcat_private.add_menu_product(
    v_session,v_tenant,v_store,v_category,'Recovery test bowl',12500);
  v_table := rcat_private.create_ordering_table(
    v_session,v_tenant,v_store,'Recovery QA table');
  PERFORM rcat_private.rotate_ordering_visit(
    v_session,v_tenant,v_store,v_table,v_visit);
  v_cart := jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('productId',v_product,'quantity',1,
      'optionIds',jsonb_build_array())));
  v_order := (rcat_private.place_guest_order(
    v_visit,'g4-recovery-test-001',v_cart)->>'orderId')::uuid;
  PERFORM rcat_private.transition_merchant_order(
    v_session,v_tenant,v_store,v_order,'submitted','accepted');
  PERFORM rcat_private.transition_merchant_order(
    v_session,v_tenant,v_store,v_order,'accepted','preparing');
  PERFORM rcat_private.transition_merchant_order(
    v_session,v_tenant,v_store,v_order,'preparing','served');
  PERFORM rcat_private.place_guest_order(
    v_visit,'g4-recovery-test-002',v_cart);
  v_feed := rcat_private.merchant_order_notifications(
    v_session,v_tenant,v_store,NULL,50);
  IF jsonb_array_length(v_feed->'events') <> 5 THEN
    RAISE EXCEPTION 'Expected 5 committed Order Outbox events';
  END IF;
END $$;
RESET ROLE;
COMMIT;
DO $$
BEGIN
  IF (SELECT count(*) FROM rcat.orders) <> 2 THEN
    RAISE EXCEPTION 'Recovery fixture must persist 2 Orders';
  END IF;
  IF (SELECT count(*) FROM rcat.order_outbox_events) <> 5 THEN
    RAISE EXCEPTION 'Recovery fixture must persist 5 Outbox events';
  END IF;
  IF (SELECT count(*) FROM rcat.orders
      WHERE amount_satang=12500 AND payment_state='not_requested') <> 2 THEN
    RAISE EXCEPTION 'Recovery fixture introduced a false paid state';
  END IF;
END $$;
\echo 'PASS: committed two Orders, five Outbox events and audit for restore qualification'
