-- G5-M1 increment 2: merchant receiver management ONLY.
-- No bank credentials, live public payment QR or Order paid-state writes.
-- The receiver remains disabled, even when a Merchant configures it.
-- All reads/writes require a live authenticated owner/manager session.
CREATE FUNCTION rcat_private.merchant_promptpay_receiver(
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
      'configured',false,'enabled',false,'revision',0
    );
  END IF;
  RETURN jsonb_build_object(
    'configured',true,'enabled',v_receiver.enabled,
    'receiverKind',v_receiver.recipient_kind,
    'maskedReceiver','****'||right(v_receiver.recipient_identifier,4),
    'revision',v_receiver.revision
  );
END $$;

-- Expected-revision CAS avoids overwriting a concurrent owner change.
-- No parameter exists to enable payments; any receiver change disables it.
-- Never record a full phone/national ID in audit JSON.
CREATE FUNCTION rcat_private.set_merchant_promptpay_receiver(
  p_session_digest bytea, p_tenant_id uuid, p_store_id uuid,
  p_receiver_kind text, p_receiver_id text, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid;
  v_old rcat.store_promptpay_receivers%ROWTYPE;
  v_revision integer;
  v_changed boolean;
BEGIN
  v_actor:=rcat_private._catalog_actor(
    p_session_digest,p_tenant_id,p_store_id,true
  );
  IF p_receiver_kind IS NULL OR p_receiver_id IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision<0
    OR p_expected_revision>=2147483647
    OR NOT (
      (p_receiver_kind='mobile' AND p_receiver_id ~ '^0[689][0-9]{8}$')
      OR (p_receiver_kind='national_id' AND p_receiver_id ~ '^[0-9]{13}$')
    )
  THEN
    RAISE EXCEPTION 'Invalid PromptPay receiver' USING ERRCODE='22023';
  END IF;

  -- A store-level row lock serializes first insert and later edits across pods.
  PERFORM 1 FROM rcat.stores
  WHERE tenant_id=p_tenant_id AND id=p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_old
  FROM rcat.store_promptpay_receivers
  WHERE tenant_id=p_tenant_id AND store_id=p_store_id FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_revision<>0 THEN
      RAISE EXCEPTION 'Receiver revision conflict' USING ERRCODE='P0009';
    END IF;
    INSERT INTO rcat.store_promptpay_receivers(
      tenant_id,store_id,recipient_kind,recipient_identifier,enabled,revision
    ) VALUES(
      p_tenant_id,p_store_id,p_receiver_kind,p_receiver_id,false,1
    );
    v_revision:=1;
    v_changed:=true;
  ELSE
    IF v_old.revision<>p_expected_revision THEN
      RAISE EXCEPTION 'Receiver revision conflict' USING ERRCODE='P0009';
    END IF;
    IF v_old.recipient_kind=p_receiver_kind
       AND v_old.recipient_identifier=p_receiver_id
       AND v_old.enabled=false THEN
      v_changed:=false;
      v_revision:=v_old.revision;
    ELSE
      UPDATE rcat.store_promptpay_receivers
      SET recipient_kind=p_receiver_kind,
          recipient_identifier=p_receiver_id,enabled=false,
          revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant_id AND store_id=p_store_id
      RETURNING revision INTO v_revision;
      v_changed:=true;
    END IF;
  END IF;

  IF v_changed THEN
    INSERT INTO rcat.audit_events(
      tenant_id,actor_user_id,action,subject_id,metadata
    ) VALUES(
      p_tenant_id,v_actor,'payment.receiver.configured',p_store_id,
      jsonb_build_object(
        'storeId',p_store_id,'receiverKind',p_receiver_kind,
        'maskedReceiver','****'||right(p_receiver_id,4),
        'revision',v_revision,'enabled',false
      )
    );
  END IF;
  RETURN jsonb_build_object(
    'configured',true,'changed',v_changed,
    'receiverKind',p_receiver_kind,
    'maskedReceiver','****'||right(p_receiver_id,4),
    'enabled',false,'revision',v_revision
  );
END $$;

REVOKE ALL ON FUNCTION rcat_private.merchant_promptpay_receiver(
  bytea,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.set_merchant_promptpay_receiver(
  bytea,uuid,uuid,text,text,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_promptpay_receiver(
  bytea,uuid,uuid
) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.set_merchant_promptpay_receiver(
  bytea,uuid,uuid,text,text,integer
) TO rcat_auth;
