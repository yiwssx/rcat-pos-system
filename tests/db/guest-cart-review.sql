\set ON_ERROR_STOP on
-- Disposable CI: no real customers, payment or production writes.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
 decode(repeat('b1',32),'hex'),decode(repeat('b2',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 a uuid:='00000000-0000-4000-8000-000000000001';
 st uuid:='20000000-0000-4000-8000-000000000001';
 owner bytea:=decode(repeat('b1',32),'hex');
 guest bytea:=decode(repeat('b3',32),'hex');
 wrong bytea:=decode(repeat('b4',32),'hex');
 cat uuid;pid uuid;pid2 uuid;grp uuid;opt uuid;opt2 uuid;
 tbl uuid;result jsonb;full_menu jsonb;denied boolean;
BEGIN
 cat:=rcat_private.add_menu_category(owner,a,st,'cart-review-ci','Cart review CI');
 pid:=rcat_private.add_menu_product(owner,a,st,cat,'เมนูหลัก',5000);
 pid2:=rcat_private.add_menu_product(owner,a,st,cat,'เมนูอื่น',7000);
 grp:=rcat_private.add_modifier_group(
   owner,a,st,pid,'extra-cart-ci','เพิ่มตัวเลือก',1,2);
 opt:=rcat_private.add_modifier_option(
   owner,a,st,pid,grp,'ไข่พิเศษ',1200);
 opt2:=rcat_private.add_modifier_option(
   owner,a,st,pid,grp,'เต้าหู้',900);
 tbl:=rcat_private.create_ordering_table(owner,a,st,'Checkout review table');
 PERFORM * FROM rcat_private.rotate_ordering_visit(owner,a,st,tbl,guest);
 full_menu:=rcat_private.resolve_ordering_visit(guest);
 IF jsonb_array_length(full_menu->'products')<>2 THEN
   RAISE EXCEPTION 'Fixture full menu not ready'; END IF;

 result:=rcat_private.guest_cart_review(guest,ARRAY[pid],ARRAY[opt]);
 IF jsonb_array_length(result->'products')<>1
   OR result#>>'{products,0,id}'<>pid::text
   OR result#>>'{products,0,priceSatang}'<>'5000'
   OR jsonb_array_length(result->'modifierGroups')<>1
   OR jsonb_array_length(result->'modifierOptions')<>1
   OR result#>>'{modifierOptions,0,id}'<>opt::text
   OR jsonb_array_length(result->'categories')<>1
   OR result->>'tenantId'<>a::text THEN
   RAISE EXCEPTION 'Cart review response leaked unselected data or missed selected data'; END IF;

 result:=rcat_private.guest_cart_review(guest,ARRAY[pid2],ARRAY[]::uuid[]);
 IF jsonb_array_length(result->'products')<>1
   OR jsonb_array_length(result->'modifierGroups')<>0
   OR jsonb_array_length(result->'modifierOptions')<>0 THEN
   RAISE EXCEPTION 'Unrelated Modifier leaked into selected cart'; END IF;

 -- Public availability is explicit, not an implied inventory reservation.
 -- A withdrawn product must be absent even while the bearer remains valid.
 PERFORM rcat_private.set_menu_product_availability(owner,a,st,pid,false);
 result:=rcat_private.guest_cart_review(guest,ARRAY[pid],ARRAY[opt]);
 IF jsonb_array_length(result->'products')<>0
   OR jsonb_array_length(result->'modifierGroups')<>0
   OR jsonb_array_length(result->'modifierOptions')<>0 THEN
   RAISE EXCEPTION 'Withdrawn product remains orderable in cart review'; END IF;
 PERFORM rcat_private.set_menu_product_availability(owner,a,st,pid,true);

 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_cart_review(wrong,ARRAY[pid],ARRAY[opt]);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Forged QR bearer can review cart'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_cart_review(guest,ARRAY[]::uuid[],ARRAY[]::uuid[]);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Empty cart accepted'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.guest_cart_review(
     guest,array_fill(pid,ARRAY[21]),ARRAY[]::uuid[]);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unbounded cart accepted'; END IF;
 denied:=false;
 BEGIN
   PERFORM * FROM rcat.menu_products WHERE id=pid;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Guest role can read unrestricted catalog'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: cart-only snapshot, selected modifiers, availability, invalid bearer, limits and tenant RLS'
