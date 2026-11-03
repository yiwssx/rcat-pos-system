-- G3 transactional outbox: never notify about rolled-back Orders or
-- status changes. Insert in the SAME transaction as the authoritative row.
-- The initial event is only the Order reference; full amount/items become
-- visible after commit and must be fetched from the scoped merchant inbox.
CREATE TABLE rcat.order_outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  table_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN
    ('order.submitted','order.status.changed')),
  status text NOT NULL CHECK(status IN
    ('submitted','accepted','preparing','served','cancelled')),
  previous_status text CHECK(previous_status IS NULL OR previous_status IN
    ('submitted','accepted','preparing','served','cancelled')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id,store_id,order_id)
    REFERENCES rcat.orders(tenant_id,store_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,store_id,table_id)
    REFERENCES rcat.store_tables(tenant_id,store_id,id) ON DELETE RESTRICT,
  CHECK ((event_type='order.submitted' AND status='submitted'
            AND previous_status IS NULL)
       OR (event_type='order.status.changed' AND previous_status IS NOT NULL
            AND previous_status<>status))
);
CREATE INDEX order_outbox_store_cursor_idx
  ON rcat.order_outbox_events(tenant_id,store_id,id);

-- One per staff account/store; ack is opt-in and never happens on GET.
-- The same account on multiple devices shares its ack cursor.
CREATE TABLE rcat.order_notification_cursors (
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES rcat.users(id) ON DELETE RESTRICT,
  last_event_id bigint NOT NULL DEFAULT 0 CHECK(last_event_id>=0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,store_id,user_id),
  FOREIGN KEY (tenant_id,store_id)
    REFERENCES rcat.stores(tenant_id,id) ON DELETE RESTRICT
);

ALTER TABLE rcat.order_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.order_outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE rcat.order_notification_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rcat.order_notification_cursors FORCE ROW LEVEL SECURITY;
-- Runtime roles have NO direct table grants: all access is via explicit
-- authenticated, tenant/store-scoped SECURITY DEFINER functions.

CREATE FUNCTION rcat_private._enqueue_order_outbox()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_type text;
BEGIN
  -- Serialize event sequence allocation AND commit for a single store.
  -- Without this store-scoped transaction lock, a late-committing lower
  -- ID could be skipped by a client that advanced a numeric cursor.
  PERFORM 1 FROM rcat.stores
    WHERE tenant_id=NEW.tenant_id AND id=NEW.store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox store unavailable' USING ERRCODE='23503';
  END IF;
  v_type:=CASE WHEN TG_OP='INSERT' THEN
    'order.submitted' ELSE 'order.status.changed' END;
  INSERT INTO rcat.order_outbox_events(
    tenant_id,store_id,order_id,table_id,
    event_type,status,previous_status
  ) VALUES (
    NEW.tenant_id,NEW.store_id,NEW.id,NEW.table_id,
    v_type,NEW.status,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END
  );
  RETURN NEW;
END $$;

CREATE TRIGGER order_outbox_after_insert
AFTER INSERT ON rcat.orders
FOR EACH ROW EXECUTE FUNCTION rcat_private._enqueue_order_outbox();

CREATE TRIGGER order_outbox_after_status
AFTER UPDATE OF status ON rcat.orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION rcat_private._enqueue_order_outbox();

-- Staff reconnect/poll: the outbox is append-only; reading is never ack.
-- p_after=NULL resumes the persisted per-staff ack (or starts at 0);
-- p_after=0 explicitly replays from the beginning.
CREATE FUNCTION rcat_private.merchant_order_notifications(
  p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,
  p_after bigint DEFAULT NULL,p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_user uuid;v_saved bigint;v_after bigint;v_next bigint;
  v_events jsonb;v_more boolean;
BEGIN
  SELECT actor_id INTO v_user FROM rcat_private._order_staff_actor(
    p_session_digest,p_tenant_id,p_store_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_after IS NOT NULL AND p_after<0) THEN
    RAISE EXCEPTION 'Invalid notification cursor' USING ERRCODE='22023';
  END IF;
  SELECT last_event_id INTO v_saved
    FROM rcat.order_notification_cursors
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id AND user_id=v_user;
  v_saved:=coalesce(v_saved,0);
  v_after:=coalesce(p_after,v_saved);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'eventId',e.id::text,'eventType',e.event_type,
      'orderId',e.order_id,'tableId',e.table_id,
      'status',e.status,'previousStatus',e.previous_status,
      'occurredAt',e.occurred_at
    ) ORDER BY e.id),'[]'::jsonb)
  INTO v_events
  FROM (
    SELECT * FROM rcat.order_outbox_events
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id AND id>v_after
    ORDER BY id LIMIT p_limit
  ) e;
  IF jsonb_array_length(v_events)>0 THEN
    v_next:=(v_events->(jsonb_array_length(v_events)-1)->>'eventId')::bigint;
  ELSE v_next:=v_after;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM rcat.order_outbox_events
    WHERE tenant_id=p_tenant_id AND store_id=p_store_id AND id>v_next
  ) INTO v_more;
  RETURN jsonb_build_object(
    'events',v_events,'nextCursor',v_next::text,
    'acknowledgedCursor',v_saved::text,'hasMore',v_more
  );
END $$;

-- An authenticated merchant can acknowledge ONLY a real committed event
-- from its own store. Monotonic ack prevents delayed devices moving it back.
CREATE FUNCTION rcat_private.ack_merchant_order_notification(
  p_session_digest bytea,p_tenant_id uuid,p_store_id uuid,p_event_id bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE v_user uuid;v_saved bigint;
BEGIN
  SELECT actor_id INTO v_user FROM rcat_private._order_staff_actor(
    p_session_digest,p_tenant_id,p_store_id);
  IF p_event_id IS NULL OR p_event_id<=0 OR NOT EXISTS (
    SELECT 1 FROM rcat.order_outbox_events
    WHERE id=p_event_id AND tenant_id=p_tenant_id AND store_id=p_store_id
  ) THEN
    RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO rcat.order_notification_cursors(
    tenant_id,store_id,user_id,last_event_id
  ) VALUES (p_tenant_id,p_store_id,v_user,p_event_id)
  ON CONFLICT(tenant_id,store_id,user_id)
  DO UPDATE SET
    last_event_id=greatest(
      rcat.order_notification_cursors.last_event_id,
      EXCLUDED.last_event_id),
    updated_at=clock_timestamp()
  RETURNING last_event_id INTO v_saved;
  RETURN jsonb_build_object('acknowledgedCursor',v_saved::text);
END $$;

REVOKE ALL ON FUNCTION rcat_private._enqueue_order_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.merchant_order_notifications(bytea,uuid,uuid,bigint,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rcat_private.ack_merchant_order_notification(bytea,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rcat_private.merchant_order_notifications(bytea,uuid,uuid,bigint,integer) TO rcat_auth;
GRANT EXECUTE ON FUNCTION rcat_private.ack_merchant_order_notification(bytea,uuid,uuid,bigint) TO rcat_auth;
