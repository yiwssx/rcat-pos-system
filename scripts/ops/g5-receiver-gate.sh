#!/usr/bin/env bash
# Operator-only per-store DBA gate. Does not verify a bank or authorize live money.
set -euo pipefail
set +x
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="$root/.env.portal"
fail() { echo "G5 GATE: $*" >&2; exit 1; }
usage() {
  echo "Usage: $0 status TENANT_UUID STORE_UUID"
  echo "       $0 enable|disable TENANT_UUID STORE_UUID REVISION --apply"
  exit 2
}
action="${1:-}"; tenant="${2:-}"; store="${3:-}"
uuid='^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
[[ "$tenant" =~ $uuid && "$store" =~ $uuid ]] || usage
if [[ "$action" == status && $# == 3 ]]; then
  revision=0; approval=read_only
elif [[ ( "$action" == enable || "$action" == disable ) && $# == 5 &&
        "${5:-}" == --apply && "${4:-}" =~ ^[1-9][0-9]{0,8}$ ]]; then
  revision="$4"; approval="${RCAT_POS_PAYMENT_APPROVAL_REF:-}"
  [[ "$approval" =~ ^[a-zA-Z0-9_./:#-]{8,120}$ ]] ||
    fail "Private non-sensitive approval/incident reference required"
  if [[ "$action" == enable ]]; then
    [[ "${RCAT_POS_PAYMENT_G6_GO_NOGO:-}" == approved ]] ||
      fail "G6 signed owner go/no-go required before enable"
  fi
else
  usage
fi
[[ -f "$env_file" && ! -L "$env_file" ]] || fail "Protected portal config not found"
mode="$(stat -c %a "$env_file")"
[[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "Invalid env permissions"
(( (8#$mode & 077) == 0 )) || fail "Portal env must be mode 600"
[[ "$(stat -c %u "$env_file")" == "$EUID" ]] || fail "Use owning operator"
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY \
    -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock \
    compose --project-directory "$root" --env-file "$env_file" \
    -p rcat-pos-staging -f "$root/compose.portal.yaml" "$@"
}
docker_local config --quiet >/dev/null || fail "Invalid portal config"
if [[ "$action" == enable ]]; then
  docker_local exec -T api sh -ec '
    [ "${NODE_ENV:-}" = production ] &&
    [ "${ENABLE_DEVELOPMENT_AUTH:-true}" = false ] &&
    [ "${RCAT_POS_PAYMENT_QR_RELEASE_APPROVED:-false}" = true ] &&
    [ "${RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED:-false}" = true ]
  ' || fail "API payment QR/slip flags not active or production auth not enforced"
fi
# No bank ID/password on command line, in logs or in audit JSON.
docker_local exec -T postgres sh -ec '
  export PGPASSWORD="$(cat /run/secrets/staging_pg_password)"
  exec psql -X -q -A -t -v ON_ERROR_STOP=1 \
    -U rcat_pos_staging_dba -d rcat_pos_staging \
    -v "g5_action=$1" -v "g5_tenant=$2" -v "g5_store=$3" \
    -v "g5_revision=$4" -v "g5_approval=$5"
' sh "$action" "$tenant" "$store" "$revision" "$approval" <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT set_config('rcat.g5.action', :'g5_action', true);
SELECT set_config('rcat.g5.tenant', :'g5_tenant', true);
SELECT set_config('rcat.g5.store', :'g5_store', true);
SELECT set_config('rcat.g5.revision', :'g5_revision', true);
SELECT set_config('rcat.g5.approval', :'g5_approval', true);
DO $g5$
DECLARE
  a text := current_setting('rcat.g5.action');
  t uuid := current_setting('rcat.g5.tenant')::uuid;
  s uuid := current_setting('rcat.g5.store')::uuid;
  e integer := current_setting('rcat.g5.revision')::integer;
  r rcat.store_promptpay_receivers%ROWTYPE;
  desired boolean;
BEGIN
  SELECT * INTO r FROM rcat.store_promptpay_receivers
   WHERE tenant_id=t AND store_id=s FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receiver not configured for exact store'; END IF;
  IF a='status' THEN RETURN; END IF;
  IF r.revision<>e THEN RAISE EXCEPTION 'Receiver revision changed'; END IF;
  desired := a='enable';
  IF r.enabled=desired THEN
    RAISE EXCEPTION 'Receiver already in requested state';
  END IF;
  UPDATE rcat.store_promptpay_receivers
  SET enabled=desired, revision=revision+1, updated_at=clock_timestamp()
  WHERE tenant_id=t AND store_id=s;
  INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
  VALUES (t,NULL,
    CASE WHEN desired THEN 'payment.receiver.operator_enabled'
      ELSE 'payment.receiver.operator_disabled' END,
    s,jsonb_build_object(
      'approvalRef',current_setting('rcat.g5.approval'),
      'revision',r.revision+1,'receiverKind',r.recipient_kind,
      'maskedReceiver','****'||right(r.recipient_identifier,4),
      'enabled',desired));
END $g5$;
SELECT jsonb_build_object(
  'configured',true,'enabled',enabled,'revision',revision,
  'receiverKind',recipient_kind,
  'maskedReceiver','****'||right(recipient_identifier,4))
FROM rcat.store_promptpay_receivers
WHERE tenant_id=:'g5_tenant'::uuid AND store_id=:'g5_store'::uuid;
COMMIT;
SQL
