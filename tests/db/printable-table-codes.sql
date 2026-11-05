\set ON_ERROR_STOP on
-- Entire challenge and existing Order lifecycle fixture rolls back.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
 decode(repeat('e5',32),'hex'),decode(repeat('e6',32),'hex'),
 now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 b uuid:='00000000-0000-4000-8000-000000000002';
 st uuid:='20000000-0000-4000-8000-000000000001';
 staff bytea:=decode(repeat('e5',32),'hex');
 old_code bytea:=decode(repeat('55',32),'hex');
 new_code bytea:=decode(repeat('56',32),'hex');
 wrong bytea:=decode(repeat('ff',32),'hex');
 old_guest bytea:=decode(repeat('a7',32),'hex');
 newer_guest bytea:=decode(repeat('a8',32),'hex');
 t uuid;c uuid;p uuid;v jsonb;detail jsonb;ordered jsonb;
 denied boolean;attempt integer;
BEGIN
 c:=rcat_private.add_menu_category(staff,a,st,'g2-static-code','Static QR');
 p:=rcat_private.add_menu_product(staff,a,st,c,'Menu with table code',12500);
 t:=rcat_private.create_ordering_table(staff,a,st,'QR print table 1');
 detail:=rcat_private.list_printable_tables(staff,a,st);
 IF jsonb_array_length(detail->'tables')<>1
    OR detail#>>'{tables,0,label}'<>'QR print table 1'
    OR detail::text LIKE '%55%' THEN
   RAISE EXCEPTION 'Printable table list leaked code or table info'; END IF;
 detail:=rcat_private.printable_table_detail(staff,a,st,t);
 IF detail->>'label'<>'QR print table 1' THEN
   RAISE EXCEPTION 'QR table detail wrong label'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.printable_table_detail(staff,b,st,t);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign tenant QR leaked'; END IF;
 v:=rcat_private.issue_table_code(staff,a,st,t,
      decode(repeat('d5',32),'hex'),old_code);
 IF v->>'visitId' IS NULL THEN RAISE EXCEPTION 'Visit was not issued'; END IF;
 IF (rcat_private.redeem_table_code(a,st,t,wrong,
    decode(repeat('a6',32),'hex'))->>'ok')::boolean THEN
   RAISE EXCEPTION 'Wrong code minted guest credential'; END IF;
 SELECT code_failed_attempts INTO attempt FROM rcat.table_ordering_visits
 WHERE id=(v->>'visitId')::uuid;
 IF attempt<>1 THEN RAISE EXCEPTION 'Bad attempt did not persist'; END IF;
 detail:=rcat_private.redeem_table_code(a,st,t,old_code,old_guest);
 IF NOT (detail->>'ok')::boolean THEN
   RAISE EXCEPTION 'Valid code did not issue guest grant'; END IF;
 detail:=rcat_private.resolve_ordering_visit(old_guest);
 IF detail->>'tableId'<>t::text OR detail->>'tenantId'<>a::text THEN
   RAISE EXCEPTION 'Guest grant did not resolve scoped visit'; END IF;
 ordered:=rcat_private.place_guest_order(old_guest,'static-qr-order-000001',
  jsonb_build_object('items',jsonb_build_array(
   jsonb_build_object('productId',p,'quantity',1,'optionIds','[]'::jsonb))));
 IF ordered->>'paymentState'<>'not_requested' THEN
   RAISE EXCEPTION 'QR code created an unverified paid state'; END IF;
 PERFORM set_config('test.static_qr_order',ordered->>'orderId',true);
 FOR attempt IN 1..12 LOOP
   PERFORM rcat_private.redeem_table_code(a,st,t,wrong,
     decode(lpad(to_hex(attempt),64,'0'),'hex'));
 END LOOP;
 detail:=rcat_private.redeem_table_code(a,st,t,old_code,
   decode(repeat('a9',32),'hex'));
 IF (detail->>'ok')::boolean THEN
   RAISE EXCEPTION 'Thirteenth try bypassed table rate cap'; END IF;
 v:=rcat_private.issue_table_code(staff,a,st,t,
   decode(repeat('d6',32),'hex'),new_code);
 detail:=rcat_private.redeem_table_code(a,st,t,old_code,
   decode(repeat('ab',32),'hex'));
 IF (detail->>'ok')::boolean THEN
   RAISE EXCEPTION 'Rotated code still redeems'; END IF;
 denied:=false;
 BEGIN PERFORM rcat_private.resolve_ordering_visit(old_guest);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN
   RAISE EXCEPTION 'Previous guest grant survived table rotation'; END IF;
 detail:=rcat_private.redeem_table_code(a,st,t,new_code,newer_guest);
 IF NOT (detail->>'ok')::boolean THEN
   RAISE EXCEPTION 'New code failed after rotation'; END IF;
 detail:=rcat_private.resolve_ordering_visit(newer_guest);
 IF detail->>'tableId'<>t::text THEN
   RAISE EXCEPTION 'New visit redeemed wrong table'; END IF;
 detail:=rcat_private.redeem_table_code(b,st,t,new_code,
   decode(repeat('b1',32),'hex'));
 IF (detail->>'ok')::boolean THEN
   RAISE EXCEPTION 'Foreign tenant minted a grant'; END IF;
 denied:=false;
 BEGIN
  INSERT INTO rcat.table_guest_grants(visit_id,token_digest,expires_at)
  VALUES((v->>'visitId')::uuid,decode(repeat('fa',32),'hex'),
    now()+interval '1 hour');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Direct guest grant insert bypass'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.orders
     WHERE id=current_setting('test.static_qr_order')::uuid
       AND amount_satang=12500 AND payment_state='not_requested')<>1 THEN
   RAISE EXCEPTION 'Old Order changed after code rotation'; END IF;
END $$;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id',
 '00000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM 1 FROM rcat.table_guest_grants;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Grant digests visible to tenant role'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: printed public table QR, rotating staff code, 12-try cap, per-device grant, old Order and RLS'
