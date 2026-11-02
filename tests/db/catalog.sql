\set ON_ERROR_STOP on
-- EPHEMERAL CI ONLY; no persisted catalog fixtures remain after ROLLBACK.
BEGIN;
INSERT INTO rcat_private.auth_sessions(user_id,token_digest,csrf_digest,expires_at)
VALUES
 ('10000000-0000-4000-8000-000000000001',decode(repeat('c7',32),'hex'),
  decode(repeat('e7',32),'hex'),now()+interval '1 hour'),
 ('10000000-0000-4000-8000-000000000002',decode(repeat('c8',32),'hex'),
  decode(repeat('e8',32),'hex'),now()+interval '1 hour');
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE a uuid;b uuid;p uuid;snapshot jsonb;denied boolean;ready boolean;
BEGIN
  a:=rcat_private.add_menu_category(
    decode(repeat('c7',32),'hex'),
    '00000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001','thai-food','อาหารไทย');
  p:=rcat_private.add_menu_product(
    decode(repeat('c7',32),'hex'),
    '00000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',a,'ข้าวผัด',8900);
  IF p IS NULL THEN RAISE EXCEPTION 'product creation failed'; END IF;
  snapshot:=rcat_private.catalog_snapshot(
    decode(repeat('c7',32),'hex'),
    '00000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001');
  IF jsonb_array_length(snapshot->'products')<>1 OR
     (snapshot#>>'{products,0,priceSatang}')::bigint<>8900
    THEN RAISE EXCEPTION 'catalog snapshot incorrect'; END IF;
  ready:=rcat_private.set_menu_product_availability(
    decode(repeat('c7',32),'hex'),
    '00000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',p,false);
  IF ready THEN RAISE EXCEPTION 'sold-out flag ignored'; END IF;
  -- A tenant A login must not create a category for tenant B.
  denied:=false;
  BEGIN
    PERFORM rcat_private.add_menu_category(
      decode(repeat('c7',32),'hex'),
      '00000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002','breach','Breach');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'cross-tenant catalog modification'; END IF;
  b:=rcat_private.add_menu_category(
    decode(repeat('c8',32),'hex'),
    '00000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002','other','Other');
  -- Products must not reference a category from another tenant/store.
  denied:=false;
  BEGIN
    PERFORM rcat_private.add_menu_product(
      decode(repeat('c7',32),'hex'),
      '00000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',b,'Leaked item',500);
  EXCEPTION WHEN foreign_key_violation THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'cross-store category reference'; END IF;
  denied:=false;
  BEGIN
    PERFORM rcat_private.add_menu_product(
      decode(repeat('c7',32),'hex'),
      '00000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',a,'Invalid',-1);
  EXCEPTION WHEN check_violation THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'negative product price accepted'; END IF;
  denied:=false;
  BEGIN
    INSERT INTO rcat.menu_products(tenant_id,store_id,category_id,name,price_satang)
    VALUES('00000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001',a,'Raw write',100);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'auth role has direct product insert'; END IF;
  PERFORM set_config('test.catalog_category',a::text,true);
END $$;
RESET ROLE;
SET LOCAL ROLE rcat_app;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.menu_categories)<>1 THEN
    RAISE EXCEPTION 'app RLS did not limit categories to tenant A'; END IF;
 IF (SELECT count(*) FROM rcat.menu_products)<>1 THEN
    RAISE EXCEPTION 'app RLS did not limit products to tenant A'; END IF;
END $$;
SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
 IF (SELECT count(*) FROM rcat.menu_categories)<>1 THEN
    RAISE EXCEPTION 'app RLS did not limit categories to tenant B'; END IF;
 IF (SELECT count(*) FROM rcat.menu_products)<>0 THEN
    RAISE EXCEPTION 'app RLS exposed tenant A product to B'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: catalog tenant/store FKs, RLS, session writes, satang pricing and sold-out'
