\set ON_ERROR_STOP on
-- CI fixture: real PostgreSQL RLS and atomic request budgets, no live money.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
 decode(repeat('f3',32),'hex'),decode(repeat('f4',32),'hex'),
 now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 b uuid:='00000000-0000-4000-8000-000000000002';
 st uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('f3',32),'hex');
 visit_secret bytea:=decode(repeat('f5',32),'hex');
 foreign_secret bytea:=decode(repeat('f6',32),'hex');
 bucket_subject bytea:=decode(repeat('f7',32),'hex');
 another_subject bytea:=decode(repeat('f8',32),'hex');
 category uuid;tbl uuid;v_visit_id uuid;product_id uuid;
 i integer;batch integer;n integer:=0;
 page jsonb;item jsonb;
 seen uuid[]:=ARRAY[]::uuid[];
 cursor_time timestamptz;cursor_id uuid;
 denied boolean;limited boolean;
BEGIN
 category:=rcat_private.add_menu_category(owner,a,st,'guest-keyset','Guest page items');
 FOR i IN 1..55 LOOP
   product_id:=rcat_private.add_menu_product(owner,a,st,category,
     'เมนูทดสอบ '||lpad(i::text,3,'0'),1000+i);
 END LOOP;
 tbl:=rcat_private.create_ordering_table(owner,a,st,'G2 Guest Budget Table');
 SELECT rotation.visit_id INTO v_visit_id FROM rcat_private.rotate_ordering_visit(
   owner,a,st,tbl,visit_secret) AS rotation;
 IF v_visit_id IS NULL THEN RAISE EXCEPTION 'Could not rotate visit'; END IF;

 FOR batch IN 1..3 LOOP
   page:=rcat_private.guest_catalog_page(
     visit_secret,'',NULL,cursor_time,cursor_id,20);
   IF (batch<3 AND jsonb_array_length(page->'products')<>20)
      OR (batch=3 AND jsonb_array_length(page->'products')<>15) THEN
     RAISE EXCEPTION 'Wrong Guest page size at %',batch;
   END IF;
   IF (page->>'hasMore')::boolean IS DISTINCT FROM (batch<3)
     THEN RAISE EXCEPTION 'Wrong Guest page termination'; END IF;
   IF page->>'tenantId'<>a::text OR page->>'storeId'<>st::text
      OR page->>'visitId'<>v_visit_id::text
      OR jsonb_array_length(page->'categories')=0 THEN
     RAISE EXCEPTION 'Guest page missing visit or tenant scope';
   END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(page->'products') LOOP
     product_id:=(item->>'id')::uuid;
     IF product_id=ANY(seen) THEN
       RAISE EXCEPTION 'Guest page duplicated product %',product_id;
     END IF;
     IF (item->>'priceSatang')::int NOT BETWEEN 1001 AND 1055
        OR item->>'hasImage'<>'false' THEN
       RAISE EXCEPTION 'Guest page leaked product data';
     END IF;
     seen:=array_append(seen,product_id);
     n:=n+1;
   END LOOP;
   IF batch<3 THEN
     cursor_time:=(page#>>'{nextCursor,createdAt}')::timestamptz;
     cursor_id:=(page#>>'{nextCursor,id}')::uuid;
     IF cursor_time IS NULL OR cursor_id IS NULL
       THEN RAISE EXCEPTION 'Missing Guest keyset cursor'; END IF;
   ELSE
     IF page->'nextCursor'<>'null'::jsonb
       THEN RAISE EXCEPTION 'Last Guest page has a cursor'; END IF;
   END IF;
 END LOOP;
 IF n<>55 THEN RAISE EXCEPTION 'Guest pagination omitted products'; END IF;
 page:=rcat_private.guest_catalog_page(visit_secret,'เมนูทดสอบ 00',category,NULL,NULL,24);
 IF jsonb_array_length(page->'products')<>9 THEN
   RAISE EXCEPTION 'Thai Guest search mismatch'; END IF;
 page:=rcat_private.guest_catalog_page(visit_secret,'เมนูทดสอบ',
   b,NULL,NULL,20);
 IF jsonb_array_length(page->'products')<>0
   THEN RAISE EXCEPTION 'Foreign category leaked Guest items'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_catalog_page(
      foreign_secret,'',NULL,NULL,NULL,24);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unknown Guest bearer accepted'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_catalog_page(
      visit_secret,'',NULL,NULL,NULL,51);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unbounded Guest catalog page accepted'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_catalog_page(
      visit_secret,'',NULL,now(),NULL,20);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Half-keyset cursor accepted'; END IF;

 -- Shared budget is atomic in PostgreSQL, not app process memory.
 FOR i IN 1..30 LOOP
   limited:=rcat_private.claim_guest_request_budget('redeem-ip',bucket_subject);
   IF NOT limited THEN RAISE EXCEPTION 'Early Guest budget refusal at %',i; END IF;
 END LOOP;
 IF rcat_private.claim_guest_request_budget('redeem-ip',bucket_subject)
   THEN RAISE EXCEPTION 'Guest budget 31st request accepted'; END IF;
 IF NOT rcat_private.claim_guest_request_budget('resolve-ip',bucket_subject)
   OR NOT rcat_private.claim_guest_request_budget('redeem-ip',another_subject)
   THEN RAISE EXCEPTION 'Budget lane or subject contaminated'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.claim_guest_request_budget('unlimited',bucket_subject);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unknown budget lane bypassed policy'; END IF;
 denied:=false;
 BEGIN
   PERFORM * FROM rcat_private.guest_request_budgets;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Runtime role can read Guest budget table'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: 55-row public Guest keyset paging, Thai search, token isolation, bounded PostgreSQL shared budgets'
