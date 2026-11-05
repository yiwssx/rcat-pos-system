\set ON_ERROR_STOP on
-- CI-only reversible fixture: catalog CAS edits, soft archive and Order invariants.
BEGIN;
INSERT INTO rcat.users(id,email,password_hash) VALUES
 ('10000000-0000-4000-8000-000000000093','catalog-cashier@test.invalid','NOLOGIN');
INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000093','cashier');
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',
   decode(repeat('a1',32),'hex'),decode(repeat('a2',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',
   decode(repeat('b1',32),'hex'),decode(repeat('b2',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000093',
   decode(repeat('c1',32),'hex'),decode(repeat('c2',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 b uuid:='00000000-0000-4000-8000-000000000002';
 store_a uuid:='20000000-0000-4000-8000-000000000001';
 store_b uuid:='20000000-0000-4000-8000-000000000002';
 owner bytea:=decode(repeat('a1',32),'hex');
 other_owner bytea:=decode(repeat('b1',32),'hex');
 cashier bytea:=decode(repeat('c1',32),'hex');
 visit bytea:=decode(repeat('a3',32),'hex');
 category_a uuid;category_next uuid;category_b uuid;product uuid;tab uuid;
 first_order uuid;next_order uuid;
 result jsonb;snapshot jsonb;cart jsonb;denied boolean;n bigint;
BEGIN
 category_a:=rcat_private.add_menu_category(owner,a,store_a,'catalog-edit-old','Old');
 category_next:=rcat_private.add_menu_category(owner,a,store_a,'catalog-edit-next','Next');
 category_b:=rcat_private.add_menu_category(other_owner,b,store_b,'catalog-foreign','Foreign');
 product:=rcat_private.add_menu_product(owner,a,store_a,category_a,'Original',8900);
 tab:=rcat_private.create_ordering_table(owner,a,store_a,'Catalog editable table');
 PERFORM rcat_private.rotate_ordering_visit(owner,a,store_a,tab,visit);
 cart:=jsonb_build_object('items',jsonb_build_array(
   jsonb_build_object('productId',product,'quantity',1,
     'optionIds',jsonb_build_array())));
 first_order:=(rcat_private.place_guest_order(
     visit,'catalog-first-order-0001',cart)->>'orderId')::uuid;
 result:=rcat_private.update_menu_product(
   owner,a,store_a,product,0,'New sale name',category_next,12000);
 IF result->>'name'<>'New sale name' OR (result->>'priceSatang')::bigint<>12000
    OR (result->>'revision')::bigint<>1 OR NOT (result->>'changed')::boolean
 THEN RAISE EXCEPTION 'Product editing failed'; END IF;
 snapshot:=rcat_private.catalog_snapshot(owner,a,store_a);
 IF (snapshot#>>'{products,0,revision}')::bigint<>1
   OR (snapshot#>>'{products,0,categoryId}')::uuid<>category_next
   OR (snapshot#>>'{products,0,priceSatang}')::bigint<>12000
 THEN RAISE EXCEPTION 'Updated Merchant catalog inaccurate'; END IF;
 next_order:=(rcat_private.place_guest_order(
     visit,'catalog-second-order-0001',cart)->>'orderId')::uuid;
 PERFORM set_config('test.catalog_first_order',first_order::text,true);
 PERFORM set_config('test.catalog_next_order',next_order::text,true);
 PERFORM set_config('test.catalog_product',product::text,true);
 -- No-op uses same revision and must not append an unnecessary audit event.
 result:=rcat_private.update_menu_product(
   owner,a,store_a,product,1,'New sale name',category_next,12000);
 IF (result->>'changed')::boolean OR (result->>'revision')::bigint<>1 THEN
   RAISE EXCEPTION 'No-op product update changed revision'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.update_menu_product(
      owner,a,store_a,product,0,'stale',category_next,15000);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale browser overwrote live price'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.update_menu_product(
      owner,a,store_a,product,1,'wrong',category_b,15000);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-store category accepted'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.update_menu_product(
     cashier,a,store_a,product,1,'cashier write',category_a,9000);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Cashier edited product'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.archive_menu_product(
     other_owner,a,store_a,product,1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign owner archived local product'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.archive_menu_product(owner,a,store_a,product,0);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale archive accepted'; END IF;

 -- A simultaneous sold-out toggle bumps revision and must conflict with
 -- old drafts before archiving.
 PERFORM rcat_private.set_menu_product_availability(
    owner,a,store_a,product,false);
 result:=rcat_private.archive_menu_product(
    owner,a,store_a,product,2);
 IF (result->>'revision')::bigint<>3 OR (result->>'available')::boolean
 THEN RAISE EXCEPTION 'Archive did not hide product'; END IF;
 snapshot:=rcat_private.catalog_snapshot(owner,a,store_a);
 IF snapshot#>>'{products,0,archivedAt}' IS NULL
    OR (snapshot#>>'{products,0,available}')::boolean
 THEN RAISE EXCEPTION 'Archived product missing merchant metadata'; END IF;
 snapshot:=rcat_private.resolve_ordering_visit(visit);
 IF jsonb_array_length(snapshot->'products')<>0 THEN
   RAISE EXCEPTION 'Archived product leaked to public guest menu'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.place_guest_order(visit,'catalog-third-order-0001',cart);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Guest bought archived product'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.set_menu_product_availability(owner,a,store_a,product,true);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Archived product reactivated'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.update_menu_product(
     owner,a,store_a,product,3,'resurrect',category_a,100);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Archived product edited'; END IF;
 denied:=false;
 BEGIN
   UPDATE rcat.menu_products SET name='bypass'
   WHERE id=product;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Restricted auth role directly updated product'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE first_order uuid:=current_setting('test.catalog_first_order')::uuid;
 next_order uuid:=current_setting('test.catalog_next_order')::uuid;
 product uuid:=current_setting('test.catalog_product')::uuid;
BEGIN
 IF (SELECT count(*) FROM rcat.order_items
     WHERE order_id=first_order AND product_name='Original'
       AND base_price_satang=8900 AND line_total_satang=8900)<>1
 THEN RAISE EXCEPTION 'Old immutable Order price/name changed'; END IF;
 IF (SELECT count(*) FROM rcat.order_items
     WHERE order_id=next_order AND product_name='New sale name'
       AND base_price_satang=12000 AND line_total_satang=12000)<>1
 THEN RAISE EXCEPTION 'New Order did not snapshot edited product price'; END IF;
 IF (SELECT count(*) FROM rcat.menu_products
     WHERE id=product AND archived_at IS NOT NULL AND available=false
       AND revision=3)<>1
 THEN RAISE EXCEPTION 'Archived product row was deleted or modified'; END IF;
 IF (SELECT count(*) FROM rcat.audit_events
     WHERE subject_id=product AND action='catalog.product.updated')<>1
 THEN RAISE EXCEPTION 'Expected one and only one update audit event'; END IF;
 IF (SELECT count(*) FROM rcat.audit_events
     WHERE subject_id=product AND action='catalog.product.archived')<>1
 THEN RAISE EXCEPTION 'Archive audit missing'; END IF;
END $;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id',
 '00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM rcat.menu_products
     WHERE name='New sale name') THEN
   RAISE EXCEPTION 'RLS exposed archived tenant A product to tenant B'; END IF;
END $;
ROLLBACK;
\echo 'PASS: product CAS edit/soft archive, RBAC/RLS, immutable old Orders, guest hidden stock and audit'
