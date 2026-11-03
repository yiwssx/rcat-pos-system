\set ON_ERROR_STOP on
-- Ephemeral PostgreSQL keyset pagination: >50 Orders in one transaction
-- share the exact same created_at, so UUID tie-breaks are mandatory.
BEGIN;
INSERT INTO rcat_private.auth_sessions(
  user_id,token_digest,csrf_digest,expires_at
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  decode(repeat('bc',32),'hex'),decode(repeat('bd',32),'hex'),
  now()+interval '1 hour'
);
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  v_tenant uuid:='00000000-0000-4000-8000-000000000001';
  v_store uuid:='20000000-0000-4000-8000-000000000001';
  v_actor bytea:=decode(repeat('bc',32),'hex');
  v_visit bytea:=decode(repeat('be',32),'hex');
  v_category uuid;v_product uuid;v_table uuid;
  v_cart jsonb;v_result jsonb;v_page jsonb;v_row jsonb;
  v_cursor text;v_count integer:=0;v_n integer;
  v_ids text[]:=ARRAY[]::text[];
  v_last_uuid uuid;v_first_order uuid;
  v_first_time text;v_step integer;v_expected boolean;
  denied boolean;
BEGIN
  v_category:=rcat_private.add_menu_category(
    v_actor,v_tenant,v_store,'pagination-test','Pagination');
  v_product:=rcat_private.add_menu_product(
    v_actor,v_tenant,v_store,v_category,'Historical bowl',11900);
  v_table:=rcat_private.create_ordering_table(
    v_actor,v_tenant,v_store,'Pagination table');
  PERFORM rcat_private.rotate_ordering_visit(
    v_actor,v_tenant,v_store,v_table,v_visit);
  v_cart:=jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('productId',v_product,'quantity',1,
      'optionIds',jsonb_build_array())));

  FOR v_n IN 1..65 LOOP
    v_result:=rcat_private.place_guest_order(
      v_visit,'pagination-idempotency-'||lpad(v_n::text,4,'0'),
      v_cart);
    IF v_n=1 THEN v_first_order:=(v_result->>'orderId')::uuid; END IF;
  END LOOP;
  PERFORM rcat_private.transition_merchant_order(
    v_actor,v_tenant,v_store,v_first_order,'submitted','accepted');

  -- Full walk using 25/25/15, no overlap even when timestamps are equal.
  v_cursor:=NULL;
  FOR v_step IN 1..3 LOOP
    IF v_cursor IS NULL THEN
      v_page:=rcat_private.merchant_order_inbox_page(
        v_actor,v_tenant,v_store,NULL,25,NULL,NULL);
    ELSE
      v_page:=rcat_private.merchant_order_inbox_page(
        v_actor,v_tenant,v_store,NULL,25,
        split_part(v_cursor,'_',1)::timestamptz,
        split_part(v_cursor,'_',2)::uuid);
    END IF;
    IF jsonb_array_length(v_page->'orders')<>
      CASE WHEN v_step=3 THEN 15 ELSE 25 END THEN
      RAISE EXCEPTION 'Keyset page % has wrong size',v_step;
    END IF;
    v_expected:=v_step<3;
    IF (v_page->>'hasMore')::boolean IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'Wrong hasMore for page %',v_step;
    END IF;
    IF v_expected AND (
      v_page->>'nextCursor' IS NULL OR
      v_page->>'nextCursor' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z_[0-9a-f-]{36}$'
    ) THEN RAISE EXCEPTION 'Page cursor missing or lost microseconds'; END IF;
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_page->'orders')
    LOOP
      IF v_row->>'orderId'=ANY(v_ids) THEN
        RAISE EXCEPTION 'Overlapping Order in keyset pages';
      END IF;
      IF v_last_uuid IS NOT NULL AND (v_row->>'orderId')::uuid>=v_last_uuid THEN
        RAISE EXCEPTION 'Orders with matching timestamps not ordered by UUID';
      END IF;
      v_ids:=array_append(v_ids,v_row->>'orderId');
      v_last_uuid:=(v_row->>'orderId')::uuid;
      v_count:=v_count+1;
      IF v_row->>'paymentState'<>'not_requested'
        OR (v_row->>'amountSatang')::integer<>11900
        OR jsonb_array_length(v_row->'items')<>1
        OR v_row->>'visitId' IS NULL
      THEN RAISE EXCEPTION 'Paginated Order payload differs from original'; END IF;
    END LOOP;
    v_cursor:=v_page->>'nextCursor';
  END LOOP;
  IF v_count<>65 OR v_cursor IS NOT NULL THEN
    RAISE EXCEPTION 'Did not reach end of exactly 65 Orders';
  END IF;
  v_page:=rcat_private.merchant_order_inbox_page(
    v_actor,v_tenant,v_store,'accepted',50,NULL,NULL);
  IF jsonb_array_length(v_page->'orders')<>1 OR
    v_page#>>'{orders,0,orderId}'<>v_first_order::text OR
    (v_page->>'hasMore')::boolean OR v_page->>'nextCursor' IS NOT NULL
  THEN RAISE EXCEPTION 'Filtered Inbox exposes incorrect Orders'; END IF;

  v_page:=rcat_private.merchant_order_inbox_page(
    v_actor,v_tenant,v_store,NULL,1,NULL,NULL);
  IF jsonb_array_length(v_page->'orders')<>1 OR
    NOT (v_page->>'hasMore')::boolean
  THEN RAISE EXCEPTION 'One-Order page boundary incorrect'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_order_inbox_page(
      v_actor,'00000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002',NULL,5,NULL,NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant paged Inbox leaked'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_order_inbox_page(
      v_actor,v_tenant,v_store,NULL,51,NULL,NULL);
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Unbounded Inbox page accepted'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_order_inbox_page(
      v_actor,v_tenant,v_store,NULL,5,now(),NULL);
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Incomplete cursor was accepted'; END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_order_inbox_page(
      decode(repeat('ff',32),'hex'),v_tenant,v_store,
      NULL,5,NULL,NULL);
  EXCEPTION WHEN invalid_authorization_specification THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Expired or forged staff session was accepted'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: 65-Order keyset history, timestamp ties, no duplicates, bounded pages and tenant isolation'
