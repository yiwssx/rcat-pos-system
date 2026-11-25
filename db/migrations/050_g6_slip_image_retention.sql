-- Opt-in per-store G6 slip image retention. No store is enabled or configured
-- by this migration, and no real evidence is deleted at migration time.
-- Preserve financial records, state, bank digest, replay hashes and attempt limits.
ALTER TABLE rcat.store_promptpay_receivers
  ADD COLUMN slip_image_retention_days smallint
    CHECK (slip_image_retention_days=90);

ALTER TABLE rcat.payment_slip_evidence
  ALTER COLUMN png DROP NOT NULL,
  ADD COLUMN image_purged_at timestamptz,
  ADD CONSTRAINT payment_slip_image_lifecycle_check CHECK (
    (png IS NOT NULL AND image_purged_at IS NULL) OR
    (png IS NULL AND image_purged_at IS NOT NULL
      AND image_purged_at>=submitted_at+interval '2160 hours')
  );

CREATE INDEX payment_slip_image_expiry_idx
  ON rcat.payment_slip_evidence(tenant_id,store_id,submitted_at,id)
  WHERE png IS NOT NULL;

CREATE OR REPLACE FUNCTION rcat_private.merchant_payment_review_queue(
  p_session bytea,p_tenant uuid,p_store uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_actor uuid;v_rows jsonb;
BEGIN
  v_actor:=rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid review limit' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(row_data ORDER BY submitted_at DESC),'[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT s.submitted_at,
      jsonb_build_object(
        'slipId',s.id,'orderId',s.order_id,'displayNumber',
         (SELECT display_number::text FROM rcat.orders WHERE id=s.order_id),
        'amountSatang',p.amount_satang,'currency',p.currency,
        'revision',s.revision,'submittedAt',s.submitted_at,
        'state',s.state,
        'imageAvailable',s.png IS NOT NULL AND NOT (
          coalesce(r.slip_image_retention_days=90,false)
          AND s.submitted_at<=statement_timestamp()-interval '2160 hours'
        )
      ) row_data
    FROM rcat.payment_slip_evidence s
    JOIN rcat.payment_requests p ON p.id=s.request_id
      AND p.tenant_id=s.tenant_id AND p.store_id=s.store_id
    LEFT JOIN rcat.store_promptpay_receivers r
      ON r.tenant_id=s.tenant_id AND r.store_id=s.store_id
    WHERE s.tenant_id=p_tenant AND s.store_id=p_store
      AND s.state='submitted'
    ORDER BY s.submitted_at DESC LIMIT p_limit
  ) q;
  RETURN jsonb_build_object('items',v_rows);
END $$;

-- The private image must become unreadable at the deadline even when the
-- bounded maintenance operation has not yet physically removed the payload.
CREATE OR REPLACE FUNCTION rcat_private.merchant_payment_slip_png(
  p_session bytea,p_tenant uuid,p_store uuid,p_slip uuid
) RETURNS TABLE(png bytea,digest_sha256 bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM rcat_private._catalog_actor(p_session,p_tenant,p_store,true);
  RETURN QUERY SELECT s.png,s.sha256
    FROM rcat.payment_slip_evidence s
    LEFT JOIN rcat.store_promptpay_receivers r
      ON r.tenant_id=s.tenant_id AND r.store_id=s.store_id
    WHERE s.tenant_id=p_tenant AND s.store_id=p_store AND s.id=p_slip
      AND s.png IS NOT NULL
      AND NOT (coalesce(r.slip_image_retention_days=90,false)
        AND s.submitted_at<=statement_timestamp()-interval '2160 hours');
END $$;

-- Invoker rights: this is a DBA operation, not a runtime API or general
-- deletion capability. Fixed 90*24-hour cutoff from server submission.
-- Pending slips remain in review, and no payment/order state is changed.
CREATE FUNCTION rcat_private.purge_expired_payment_slip_images(
  p_tenant uuid,p_store uuid,p_limit integer
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
DECLARE
  v_now timestamptz:=statement_timestamp();
  v_removed integer;
BEGIN
  IF p_tenant IS NULL OR p_store IS NULL OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid scoped slip maintenance' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM rcat.store_promptpay_receivers
    WHERE tenant_id=p_tenant AND store_id=p_store
      AND slip_image_retention_days=90 FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slip image retention not approved for store'
      USING ERRCODE='42501';
  END IF;
  WITH candidate AS (
    SELECT s.id FROM rcat.payment_slip_evidence s
    WHERE s.tenant_id=p_tenant AND s.store_id=p_store
      AND s.png IS NOT NULL
      AND s.submitted_at<=v_now-interval '2160 hours'
    ORDER BY s.submitted_at,s.id LIMIT p_limit
    FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE rcat.payment_slip_evidence s
    SET png=NULL,image_purged_at=v_now
    FROM candidate c
    WHERE s.id=c.id AND s.tenant_id=p_tenant AND s.store_id=p_store
      AND s.png IS NOT NULL;
  GET DIAGNOSTICS v_removed=ROW_COUNT;
  IF v_removed>0 THEN
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata
    ) VALUES (p_tenant,NULL,'payment.slip.images_expired',p_store,
      jsonb_build_object('count',v_removed,'retentionDays',90));
  END IF;
  RETURN v_removed;
END $$;
REVOKE ALL ON FUNCTION rcat_private.purge_expired_payment_slip_images(
  uuid,uuid,integer) FROM PUBLIC,rcat_app,rcat_auth;
