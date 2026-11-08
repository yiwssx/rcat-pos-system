\set ON_ERROR_STOP on
-- DBA/operator grant & retention tests use transaction rollback; no live data.
BEGIN;
INSERT INTO rcat_private.guest_request_budgets(lane,subject,window_started,hits)
VALUES
 ('resolve-ip',decode(repeat('61',32),'hex'),clock_timestamp()-interval '3 days',4),
 ('resolve-ip',decode(repeat('62',32),'hex'),clock_timestamp()-interval '2 days',3),
 ('resolve-ip',decode(repeat('63',32),'hex'),clock_timestamp(),2);
SET LOCAL ROLE rcat_auth;
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
   PERFORM rcat_private.prune_guest_request_budgets();
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN
  RAISE EXCEPTION 'Guest runtime role could delete shared abuse evidence'; END IF;
 denied:=false;
 BEGIN
   PERFORM 1 FROM rcat_private.guest_request_budgets;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN
  RAISE EXCEPTION 'Guest runtime role can inspect abuse subjects'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE n bigint;
BEGIN
 SELECT rcat_private.prune_guest_request_budgets() INTO n;
 IF n<2 THEN RAISE EXCEPTION 'Old budget buckets not purged: %',n; END IF;
 IF EXISTS (
   SELECT 1 FROM rcat_private.guest_request_budgets
   WHERE subject=decode(repeat('61',32),'hex')
      OR subject=decode(repeat('62',32),'hex')
 ) THEN RAISE EXCEPTION 'Expired budget buckets survived prune'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM rcat_private.guest_request_budgets
   WHERE subject=decode(repeat('63',32),'hex')
 ) THEN RAISE EXCEPTION 'Fresh budget bucket incorrectly purged'; END IF;
END $$;
ROLLBACK;
\echo 'PASS: DBA-only old-budget cleanup, recent buckets retained, runtime roles denied'
