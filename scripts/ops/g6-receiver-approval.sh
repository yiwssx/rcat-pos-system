#!/usr/bin/env bash
# One-time independently authorized G6 approval for a stored receiver revision.
# Never checks bank ownership automatically and never enables live payments.
set -euo pipefail
set +x
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
env_file="$root/.env.portal"
fail() { echo "RECEIVER APPROVAL: $*" >&2; exit 1; }
usage() {
  echo "Usage: $0 approve|revoke TENANT_UUID STORE_UUID REVISION --apply" >&2
  exit 2
}
action="$1"; tenant="$2"; store="$3"; revision="$4"
uuid='^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
[[ ( "$action" == approve || "$action" == revoke ) &&
  "$#" == 5 && "$5" == --apply &&
  "$tenant" =~ $uuid && "$store" =~ $uuid &&
  "$revision" =~ ^[1-9][0-9]{0,8}$ ]] || usage
approval="$RCAT_POS_PAYMENT_APPROVAL_REF"
[[ "$approval" =~ ^[A-Za-z0-9_./:#-]{8,120}$ ]] ||
  fail "Private non-sensitive approval or incident reference required"
if [[ "$action" == approve ]]; then
  [[ "$RCAT_POS_PAYMENT_G6_GO_NOGO" == approved ]] ||
    fail "Signed G6 owner go/no-go required before approval"
fi
[[ -f "$env_file" && ! -L "$env_file" ]] || fail "Protected portal env missing"
mode="$(stat -c %a "$env_file")"
[[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "Invalid portal env permissions"
(( (8#$mode & 077) == 0 )) || fail "Portal env must be owner-only"
[[ "$EUID" == 0 || "$(stat -c %u "$env_file")" == "$EUID" ]] ||
  fail "Run as root or protected env owner"
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY \
    -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock \
    compose --project-directory "$root" --env-file "$env_file" \
    -p rcat-pos-staging -f "$root/compose.portal.yaml" "$@"
}
docker_local config --quiet >/dev/null || fail "Invalid portal config"
if [[ "$action" == approve ]]; then
  docker_local exec -T api sh -ec '
    [ "$NODE_ENV" = production ] &&
    [ "$ENABLE_DEVELOPMENT_AUTH" = false ] &&
    [ "$RCAT_POS_PAYMENT_QR_RELEASE_APPROVED" = true ] &&
    [ "$RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED" = true ]
  ' || fail "API QR/slip safety flags are not active"
fi
docker_local exec -T postgres sh -ec '
  export PGPASSWORD="$(cat /run/secrets/staging_pg_password)"
  exec psql -X -q -A -t -v ON_ERROR_STOP=1 \
    -U rcat_pos_staging_dba -d rcat_pos_staging \
    -v "g6_action=$1" -v "g6_tenant=$2" -v "g6_store=$3" \
    -v "g6_revision=$4" -v "g6_approval=$5"
' sh "$action" "$tenant" "$store" "$revision" "$approval" <<'SQL'
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT
  set_config('rcat.g6.action', :'g6_action', true),
  set_config('rcat.g6.tenant', :'g6_tenant', true),
  set_config('rcat.g6.store', :'g6_store', true),
  set_config('rcat.g6.revision', :'g6_revision', true),
  set_config('rcat.g6.approval', :'g6_approval', true)
\g /dev/null
DO $g6$
DECLARE
 a text:=current_setting('rcat.g6.action');
 t uuid:=current_setting('rcat.g6.tenant')::uuid;
 s uuid:=current_setting('rcat.g6.store')::uuid;
 e integer:=current_setting('rcat.g6.revision')::integer;
 r rcat.store_promptpay_receivers%ROWTYPE;
BEGIN
 SELECT * INTO r FROM rcat.store_promptpay_receivers
   WHERE tenant_id=t AND store_id=s FOR UPDATE;
 IF NOT FOUND OR r.revision<>e THEN
   RAISE EXCEPTION 'Receiver not configured or revision changed';
 END IF;
 IF a='approve' THEN
   IF r.enabled OR r.approved_revision=e THEN
     RAISE EXCEPTION 'Approval requires disabled, not-yet-approved receiver';
   END IF;
   UPDATE rcat.store_promptpay_receivers SET approved_revision=revision,
     updated_at=clock_timestamp() WHERE tenant_id=t AND store_id=s;
 ELSE
   -- Stop active or pending receiver. Keep old payments/audit immutable.
   UPDATE rcat.store_promptpay_receivers SET enabled=false,
     approved_revision=NULL,revision=revision+1,updated_at=clock_timestamp()
   WHERE tenant_id=t AND store_id=s;
 END IF;
 INSERT INTO rcat.audit_events(tenant_id,actor_user_id,action,subject_id,metadata)
 VALUES (t,NULL,
   CASE WHEN a='approve' THEN 'payment.receiver.operator_approved'
     ELSE 'payment.receiver.operator_revoked' END,
   s,jsonb_build_object(
     'approvalRef',current_setting('rcat.g6.approval'),
     'revision',CASE WHEN a='approve' THEN e ELSE e+1 END,
     'receiverKind',r.recipient_kind,
     'maskedReceiver','****'||right(r.recipient_identifier,4),
     'enabled',CASE WHEN a='approve' THEN r.enabled ELSE false END
   ));
END $g6$;
SELECT jsonb_build_object(
 'configured',true,'enabled',enabled,'revision',revision,
 'activationApproved',COALESCE(approved_revision=revision,false),
 'receiverKind',recipient_kind,
 'maskedReceiver','****'||right(recipient_identifier,4))
FROM rcat.store_promptpay_receivers
WHERE tenant_id=:'g6_tenant'::uuid AND store_id=:'g6_store'::uuid;
COMMIT;
SQL
