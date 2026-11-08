\set ON_ERROR_STOP on
-- CI-only: tenant-scoped 45-row keyset pages with ties on created_at.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',decode(repeat('d1',32),'hex'),
  decode(repeat('d2',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',decode(repeat('e1',32),'hex'),
  decode(repeat('e2',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 b uuid:='00000000-0000-4000-8000-000000000002';
 store_a uuid:='20000000-0000-4000-8000-000000000001';
 store_b uuid:='20000000-0000-4000-8000-000000000002';
 owner bytea:=decode(repeat('d1',32),'hex');
 foreign_owner bytea:=decode(repeat('e1',32),'hex');
 cat uuid; foreign_cat uuid; pid uuid;
 i integer; batch integer; n integer:=0; seen uuid[]:=ARRAY[]::uuid[];
 cursor_created timestamptz;cursor_id uuid; page jsonb; row jsonb;
 denied boolean; old_count integer;
BEGIN
 cat:=rcat_private.add_menu_category(owner,a,store_a,'page-main','Page main');
 foreign_cat:=rcat_private.add_menu_category(foreign_owner,b,store_b,'page-other','Other');
 FOR i IN 1..45 LOOP
   pid:=rcat_private.add_menu_product(
     owner,a,store_a,cat,'ทดสอบสินค้า '||lpad(i::text,3,'0'),100+i);
 END LOOP;
 PERFORM rcat_private.add_menu_product(
    foreign_owner,b,store_b,foreign_cat,'FOREIGN SECRET PRODUCT',9999);
 FOR batch IN 1..3 LOOP
   page:=rcat_private.catalog_products_page(owner,a,store_a,
     '',NULL,false,cursor_created,cursor_id,20);
   IF jsonb_array_length(page->'products')<>CASE WHEN batch=3 THEN 5 ELSE 20 END
   THEN RAISE EXCEPTION 'Unexpected page length at %',batch; END IF;
   IF (page->>'hasMore')::boolean<>(batch<3)
   THEN RAISE EXCEPTION 'Incorrect hasMore flag at %',batch; END IF;
   FOR row IN SELECT * FROM jsonb_array_elements(page->'products') LOOP
     pid:=(row->>'id')::uuid;
     IF pid=ANY(seen) THEN RAISE EXCEPTION 'Duplicate product across pages'; END IF;
     seen:=array_append(seen,pid);
     IF (row->>'priceSatang')::integer NOT BETWEEN 101 AND 145
       OR row->>'hasImage'<>'false'
     THEN RAISE EXCEPTION 'Wrong scope or product attributes'; END IF;
     n:=n+1;
   END LOOP;
   IF batch<3 THEN
      cursor_created:=(page#>>'{nextCursor,createdAt}')::timestamptz;
      cursor_id:=(page#>>'{nextCursor,id}')::uuid;
      IF cursor_created IS NULL OR cursor_id IS NULL THEN
        RAISE EXCEPTION 'Keyset cursor missing'; END IF;
   ELSE
      IF page->'nextCursor'<>'null'::jsonb
      THEN RAISE EXCEPTION 'Terminal page must not expose next cursor'; END IF;
   END IF;
 END LOOP;
 IF n<>45 THEN RAISE EXCEPTION 'Lost catalog products'; END IF;
 -- Literal name filters must never match arbitrary tenant/category products.
 page:=rcat_private.catalog_products_page(owner,a,store_a,
   'สินค้า 00',cat,false,NULL,NULL,20);
 IF jsonb_array_length(page->'products')<>9
 THEN RAISE EXCEPTION 'Thai text search incorrect'; END IF;
 page:=rcat_private.catalog_products_page(owner,a,store_a,
   '',foreign_cat,false,NULL,NULL,20);
 IF jsonb_array_length(page->'products')<>0
 THEN RAISE EXCEPTION 'Foreign category leaked products'; END IF;
 page:=rcat_private.catalog_products_page(owner,a,store_a,
   'SECRET',NULL,true,NULL,NULL,20);
 IF jsonb_array_length(page->'products')<>0
 THEN RAISE EXCEPTION 'Foreign tenant product leaked'; END IF;
 pid:=seen[1];
 PERFORM rcat_private.archive_menu_product(owner,a,store_a,pid,0);
 page:=rcat_private.catalog_products_page(owner,a,store_a,
   '',NULL,false,NULL,NULL,50);
 IF jsonb_array_length(page->'products')<>44
 THEN RAISE EXCEPTION 'Archived product not excluded'; END IF;
 page:=rcat_private.catalog_products_page(owner,a,store_a,
   '',NULL,true,NULL,NULL,50);
 IF jsonb_array_length(page->'products')<>45
 THEN RAISE EXCEPTION 'Archived product not included when requested'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.catalog_products_page(owner,a,store_a,
      '',NULL,false,NULL,NULL,51);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unbounded page allowed'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.catalog_products_page(owner,a,store_a,
      '',NULL,false,now(),NULL,20);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Incomplete cursor allowed'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.catalog_products_page(foreign_owner,a,store_a,
      '',NULL,false,NULL,NULL,20);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign tenant read allowed'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: 45-row keyset paging, archived, tenant authorization, exact filters and cursor validation'
