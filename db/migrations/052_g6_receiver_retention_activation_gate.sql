-- G6 integration of owner-controlled 90-day slip policy (050) with the
-- receiver's separately authorized Merchant web toggle (051).
-- Additive migration: never change previously checksummed 050/051.
-- New enable requires exact G6-approved receiver revision, two global
-- release flags (passed from API), and store policy; pause always allowed.

CREATE OR REPLACE FUNCTION rcat_private.merchant_promptpay_receiver(
  p_session_digest bytea, p_tenant_id uuid, p_store_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_receiver rcat.store_promptpay_receivers%ROWTYPE;
BEGIN
  -- _catalog_actor(...true) enforces tenant/store and owner/manager only.
  PERFORM rcat_private._catalog_actor(
    p_session_digest,p_tenant_id,p_store_id,true
  );
  SELECT * INTO v_receiver FROM rcat.store_promptpay_receivers
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'configured',false,'enabled',false,'revision',0,
      'activationApproved',false,'retentionReady',false
    );
  END IF;
  RETURN jsonb_build_object(
    'configured',true,'enabled',v_receiver.enabled,
    'receiverKind',v_receiver.recipient_kind,
    'maskedReceiver','****'||right(v_receiver.recipient_identifier,4),
    'revision',v_receiver.revision,
    'activationApproved',COALESCE(v_receiver.approved_revision=v_receiver.revision,false),
    'retentionReady',COALESCE(v_receiver.slip_image_retention_days=90,false)
  );
END $$;


CREATE OR REPLACE FUNCTION rcat_private.set_merchant_promptpay_activation(
  p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,
  p_enabled boolean,p_expected_revision integer,p_release_ready boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid;
  v_receiver rcat.store_promptpay_receivers%ROWTYPE;
  v_revision integer;
BEGIN
  v_actor:=rcat_private._catalog_actor(
    p_session_digest,p_tenant_id,p_store_id,true
  );
  IF p_enabled IS NULL OR p_expected_revision IS NULL OR
     p_expected_revision<1 OR p_expected_revision>=2147483647 THEN
    RAISE EXCEPTION 'Invalid activation request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_receiver FROM rcat.store_promptpay_receivers
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receiver unavailable' USING ERRCODE='42501';
  END IF;
  IF v_receiver.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'Receiver revision conflict' USING ERRCODE='P0009';
  END IF;
  -- Off is always safe (even when release flags are now off); on is not.
  IF p_enabled AND (p_release_ready IS DISTINCT FROM true OR
    v_receiver.approved_revision IS DISTINCT FROM v_receiver.revision OR
    v_receiver.slip_image_retention_days IS DISTINCT FROM 90) THEN
    RAISE EXCEPTION 'Activation not approved' USING ERRCODE='42501';
  END IF;
  IF v_receiver.enabled=p_enabled THEN
    RETURN jsonb_build_object(
      'configured',true,'enabled',v_receiver.enabled,'changed',false,
      'revision',v_receiver.revision,'receiverKind',v_receiver.recipient_kind,
      'maskedReceiver','****'||right(v_receiver.recipient_identifier,4),
      'activationApproved',COALESCE(v_receiver.approved_revision=v_receiver.revision,false),
      'retentionReady',COALESCE(v_receiver.slip_image_retention_days=90,false)
    );
  END IF;
  -- Preserve approval only across user-controlled on/off; a stale revision
  -- from DBA stop / a receiver replacement cannot become valid again.
  UPDATE rcat.store_promptpay_receivers
    SET enabled=p_enabled,revision=revision+1,
      approved_revision=CASE WHEN approved_revision=revision
        THEN revision+1 ELSE approved_revision END,
      updated_at=clock_timestamp()
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id
    RETURNING revision INTO v_revision;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
    VALUES (p_tenant_id,v_actor,
      CASE WHEN p_enabled THEN 'payment.receiver.merchant_enabled'
        ELSE 'payment.receiver.merchant_paused' END,
      p_store_id,jsonb_build_object(
        'storeId',p_store_id,'revision',v_revision,
        'receiverKind',v_receiver.recipient_kind,
        'maskedReceiver','****'||right(v_receiver.recipient_identifier,4),
        'enabled',p_enabled
      ));
  RETURN jsonb_build_object(
    'configured',true,'enabled',p_enabled,'changed',true,
    'revision',v_revision,'receiverKind',v_receiver.recipient_kind,
    'maskedReceiver','****'||right(v_receiver.recipient_identifier,4),
    'activationApproved',v_receiver.approved_revision=v_receiver.revision,
    'retentionReady',v_receiver.slip_image_retention_days=90
  );
END $$;
