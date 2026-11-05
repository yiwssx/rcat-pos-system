\set ON_ERROR_STOP on
-- CI only, no persistent binaries after ROLLBACK.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES ('10000000-0000-4000-8000-000000000001',
 decode(repeat('e7',32),'hex'),decode(repeat('e8',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE
 tenant uuid:='00000000-0000-4000-8000-000000000001';
 store uuid:='20000000-0000-4000-8000-000000000001';
 staff bytea:=decode(repeat('e7',32),'hex');
 data bytea:=decode(repeat('ac',60),'hex');
 hash bytea:=decode(repeat('bd',32),'hex');
 category uuid;product uuid;other uuid;
 result jsonb;details jsonb;denied boolean;
BEGIN
 category:=rcat_private.add_menu_category(staff,tenant,store,
   'image-food','Images');
 product:=rcat_private.add_menu_product(staff,tenant,store,
   category,'Photo food',10000);
 result:=rcat_private.put_menu_product_media(staff,tenant,store,product,
   0,data,hash,100,100);
 IF (result->>'revision')::bigint<>1 OR NOT(result->>'hasImage')::boolean
 THEN RAISE EXCEPTION 'Image upload did not bump revision'; END IF;
 details:=rcat_private.catalog_snapshot(staff,tenant,store);
 IF NOT (details#>>'{products,0,hasImage}')::boolean THEN
   RAISE EXCEPTION 'Catalog snapshot omitted WebP flag'; END IF;
 IF (SELECT count(*) FROM rcat_private.read_public_menu_media(
     tenant,store,product))<>1 THEN
   RAISE EXCEPTION 'Guest could not see active product media'; END IF;
 IF (SELECT count(*) FROM rcat_private.read_public_menu_media(
     tenant,'20000000-0000-4000-8000-000000000002',product))<>0 THEN
   RAISE EXCEPTION 'Cross-store media visible'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.put_menu_product_media(staff,tenant,store,product,
     0,data,hash,100,100);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale media write accepted'; END IF;
 PERFORM rcat_private.set_menu_product_availability(staff,tenant,store,product,false);
 IF (SELECT count(*) FROM rcat_private.read_public_menu_media(
     tenant,store,product))<>0 THEN
   RAISE EXCEPTION 'Sold out product leaked public image'; END IF;
 IF (SELECT count(*) FROM rcat_private.read_staff_menu_media(
     staff,tenant,store,product))<>1 THEN
   RAISE EXCEPTION 'Staff cannot view sold out photo'; END IF;
 result:=rcat_private.remove_menu_product_media(staff,tenant,store,product,2);
 IF (result->>'revision')::bigint<>3 OR (result->>'hasImage')::boolean THEN
   RAISE EXCEPTION 'Media removal failed'; END IF;
 IF (SELECT count(*) FROM rcat_private.read_staff_menu_media(
     staff,tenant,store,product))<>0 THEN
   RAISE EXCEPTION 'Media bytes remained after delete'; END IF;
 denied:=false;
 BEGIN
   PERFORM rcat_private.put_menu_product_media(staff,tenant,store,product,
      3,decode(repeat('aa',196609),'hex'),hash,100,100);
 EXCEPTION WHEN check_violation OR invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Oversized media accepted'; END IF;
 other:=rcat_private.add_menu_product(staff,tenant,store,
   category,'Archived media',9000);
 PERFORM rcat_private.archive_menu_product(staff,tenant,store,other,0);
 denied:=false;
 BEGIN
   PERFORM rcat_private.put_menu_product_media(staff,tenant,store,other,
     1,data,hash,100,100);
 EXCEPTION WHEN SQLSTATE 'P0009' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Archived product accepted media write'; END IF;
 denied:=false;
 BEGIN
   INSERT INTO rcat.menu_product_media(
     tenant_id,store_id,product_id,webp,digest_sha256,width,height)
   VALUES(tenant,store,product,data,hash,100,100);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Auth role has direct media table writes'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id',
 '00000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM 1 FROM rcat.menu_product_media;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Tenant role read raw media table'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: WebP media revision CAS, bounded DB size, active-only public reads, role isolation and audit'
