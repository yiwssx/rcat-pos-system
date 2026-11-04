\set ON_ERROR_STOP on
BEGIN;
-- Isolation: fixture owner/manager only, no cross-tenant read or write.
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','cashier');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
  decode(repeat('cc',32),'hex'),decode(repeat('cd',32),'hex'),
  now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
  decode(repeat('ce',32),'hex'),decode(repeat('cf',32),'hex'),
  now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
  v_tenant uuid:='00000000-0000-4000-8000-000000000001';
  v_store uuid:='20000000-0000-4000-8000-000000000001';
  v_owner bytea:=decode(repeat('cc',32),'hex');
  v_cashier bytea:=decode(repeat('ce',32),'hex');
  v_visit bytea:=decode(repeat('dd',32),'hex');
  v_day date:=(now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_product uuid;v_category uuid;v_table uuid;
  v_a uuid;v_b uuid;v_c uuid;
  v_cart jsonb;v_out jsonb;v_report jsonb;
  denied boolean;
BEGIN
  v_category:=rcat_private.add_menu_category(
    v_owner,v_tenant,v_store,'operational-report','Operational report');
  v_product:=rcat_private.add_menu_product(
    v_owner,v_tenant,v_store,v_category,'Daily Report Meal',11900);
  v_table:=rcat_private.create_ordering_table(
    v_owner,v_tenant,v_store,'Report Table');
  PERFORM rcat_private.rotate_ordering_visit(
    v_owner,v_tenant,v_store,v_table,v_visit);
  v_cart:=jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object(
      'productId',v_product,'quantity',1,'optionIds',jsonb_build_array())));

  v_out:=rcat_private.place_guest_order(
    v_visit,'operational-report-case-001',v_cart);
  v_a:=(v_out->>'orderId')::uuid;
  v_out:=rcat_private.place_guest_order(
    v_visit,'operational-report-case-002',v_cart);
  v_b:=(v_out->>'orderId')::uuid;
  v_out:=rcat_private.place_guest_order(
    v_visit,'operational-report-case-003',v_cart);
  v_c:=(v_out->>'orderId')::uuid;

  PERFORM rcat_private.transition_merchant_order(
    v_owner,v_tenant,v_store,v_a,'submitted','accepted');
  PERFORM rcat_private.transition_merchant_order(
    v_owner,v_tenant,v_store,v_a,'accepted','preparing');
  PERFORM rcat_private.transition_merchant_order(
    v_owner,v_tenant,v_store,v_a,'preparing','served');
  PERFORM rcat_private.transition_merchant_order(
    v_owner,v_tenant,v_store,v_b,'submitted','cancelled');

  v_report:=rcat_private.merchant_daily_operational_report(
    v_owner,v_tenant,v_store,v_day);
  IF v_report->>'day'<>v_day::text
    OR v_report->>'timezone'<>'Asia/Bangkok'
    OR v_report->>'snapshotType'<>'ordered_not_paid'
    OR v_report->>'paymentStatus'<>'not_implemented'
    OR (v_report->>'orderCount')::integer<>3
    OR v_report#>>'{statusCounts,served}'<>'1'
    OR v_report#>>'{statusCounts,cancelled}'<>'1'
    OR v_report#>>'{statusCounts,submitted}'<>'1'
    OR v_report->>'orderedAmountSatang'<>'35700'
    OR v_report->>'activeOrderedAmountSatang'<>'23800'
    OR v_report->>'cancelledOrderedAmountSatang'<>'11900'
    OR v_report->>'servedOrderedAmountSatang'<>'11900'
    OR jsonb_array_length(v_report->'topProducts')<>1
    OR v_report#>>'{topProducts,0,unitsOrdered}'<>'2'
    OR v_report#>>'{topProducts,0,orderedAmountSatang}'<>'23800'
    OR v_report->>'avgSecondsToAccept' IS NULL
    OR v_report->>'avgSecondsToServe' IS NULL
  THEN
    RAISE EXCEPTION 'Operational report does not reconcile to immutable Orders: %',v_report;
  END IF;

  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_daily_operational_report(
      v_cashier,v_tenant,v_store,v_day);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cashier accessed manager report'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_daily_operational_report(
      v_owner,'00000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002',v_day);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant report exposed'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_daily_operational_report(
      v_owner,v_tenant,v_store,DATE '2101-01-01');
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Unbounded report day allowed'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.merchant_daily_operational_report(
      decode(repeat('ff',32),'hex'),v_tenant,v_store,v_day);
  EXCEPTION WHEN invalid_authorization_specification THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Forged report session accepted'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: Bangkok business-day report, 3 Order totals, cancellation, product snapshots, role and tenant scope'
