#!/usr/bin/env bash
# RCAT POS On-prem STAGING: operator tools only, no automatic scheduling.
# Never executes destructive Outbox/Order maintenance or database restores.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Explicit opt-in preserves the legacy three-origin operator path.
readonly TOPOLOGY="${RCAT_POS_TOPOLOGY:-legacy}"
case "$TOPOLOGY" in
  legacy) default_env="$ROOT/.env.staging" ;;
  portal) default_env="$ROOT/.env.portal" ;;
  *) printf 'STAGING OPERATIONS DENIED: Unknown topology\n' >&2; exit 1 ;;
esac
ENV_FILE="${RCAT_POS_ENV_FILE:-$default_env}"
COMMAND="${1:-help}"
APPROVAL="${2:-}"

usage() {
  cat <<'HELP'
RCAT POS G4 on-prem staging operations (does not install schedulers):
  onprem-operations.sh backup --apply          # PostgreSQL custom archive streamed to encrypted remote restic
  onprem-operations.sh backup-check            # read-only snapshot freshness gate
  onprem-operations.sh prune-guest-budgets --apply
  onprem-operations.sh readiness               # bounded local HTTP /ready health gate
  onprem-operations.sh help
Set RCAT_POS_TOPOLOGY=portal for the canonical single-origin .env.portal / compose.portal.yaml.
Legacy .env.staging remains the default. Prior operator and backup policy approval required.
No Order/Outbox pruning, destructive restores, Payment or Production permitted.
HELP
}

fail() { printf 'STAGING OPERATIONS DENIED: %s\n' "$*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || fail "Missing $1"; }
approve() { [[ "$APPROVAL" == "--apply" ]] || fail "--apply required"; }
portal_preflight() {
  # This is an explicitly selected, trusted operator-owned shell config.
  # Do not source a less-privileged user's file as root or follow symlinks.
  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" && -s "$ENV_FILE" ]] ||
    fail "Missing protected portal env file"
  local mode
  mode="$(stat -c '%a' "$ENV_FILE")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "Invalid portal env permissions"
  (( (8#$mode & 077) == 0 )) || fail "Portal env must be mode 600"
  [[ "$(stat -c '%u' "$ENV_FILE")" == "$EUID" ]] ||
    fail "Portal env must be owned by the executing operator"
  # An inherited approval is not a substitute for protected portal policy.
  unset RCAT_POS_BACKUP_POLICY_APPROVED RCAT_POS_GUEST_RETENTION_APPROVED
}

run_preflight() {
  if [[ "$TOPOLOGY" == portal ]]; then
    portal_preflight
  else
    bash "$ROOT/scripts/ops/onprem-staging.sh" preflight >/dev/null
  fi
  # The 0600 env file is trusted operator-controlled shell syntax.
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" >/dev/null 2>&1 || fail "Invalid protected env syntax"
  set +a
  export RCAT_POS_TOPOLOGY="$TOPOLOGY"
  if [[ "$TOPOLOGY" == portal ]]; then
    # Canonical Compose is explicitly a non-payment staging manifest.
    export RCAT_POS_ENVIRONMENT="${RCAT_POS_ENVIRONMENT:-staging}"
    [[ "${RCAT_POS_HOST_BIND_IP:-}" == 127.0.0.1 ||
       "${RCAT_POS_HOST_BIND_IP:-}" == 10.10.1.100 ]] || fail "Unsafe portal listener"
    export RCAT_POS_CUSTOMER_PORT="${RCAT_POS_CUSTOMER_PORT:-11880}"
    [[ "$RCAT_POS_CUSTOMER_PORT" =~ ^[0-9]{4,5}$ ]] &&
      (( 10#$RCAT_POS_CUSTOMER_PORT >= 1024 && 10#$RCAT_POS_CUSTOMER_PORT <= 65535 )) ||
      fail "Invalid portal listener port"
    for flag in RCAT_POS_PAYMENT_QR_RELEASE_APPROVED RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED RCAT_POS_PAYMENT_FINANCE_RELEASE_APPROVED ENABLE_DEVELOPMENT_AUTH; do
      [[ "${!flag:-false}" == false ]] || fail "Portal operations require non-payment configuration"
    done
    need RCAT_POS_DB_PASSWORD_FILE
    [[ "$RCAT_POS_DB_PASSWORD_FILE" == /* &&
       -f "$RCAT_POS_DB_PASSWORD_FILE" && ! -L "$RCAT_POS_DB_PASSWORD_FILE" &&
       -s "$RCAT_POS_DB_PASSWORD_FILE" ]] || fail "Missing protected DBA secret"
    local secret_mode
    secret_mode="$(stat -c '%a' "$RCAT_POS_DB_PASSWORD_FILE")"
    [[ "$secret_mode" =~ ^[0-7]{3,4}$ ]] || fail "Invalid DBA file permissions"
    (( (8#$secret_mode & 077) == 0 )) || fail "DBA secret must be mode 600"
    [[ "${RCAT_POS_PUBLIC_ORIGIN:-}" == https://* ]] || fail "HTTPS portal origin required"
    [[ "${AUTH_DATABASE_URL:-}" != "${TENANT_DATABASE_URL:-}" ]] ||
      fail "Distinct runtime identities required"
    compose_cmd config --quiet >/dev/null 2>&1 || fail "Invalid portal Compose configuration"
  fi
  [[ "${RCAT_POS_ENVIRONMENT:-}" == staging ]] || fail "Only staging may be operated"
}
compose_cmd() {
  if [[ "$TOPOLOGY" == portal ]]; then
    env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
      docker --host=unix:///var/run/docker.sock compose --project-directory "$ROOT" \
      --env-file "$ENV_FILE" -p rcat-pos-staging -f "$ROOT/compose.portal.yaml" "$@"
  else
    docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" -f "$ROOT/compose.staging.yaml" "$@"
  fi
}

snapshot_tag() {
  if [[ "$TOPOLOGY" == portal ]]; then
    printf '%s' 'rcat-pos-staging,rcat-pos-portal,postgres16'
  else
    printf '%s' 'rcat-pos-staging'
  fi
}

restic_preflight() {
  need RESTIC_REPOSITORY
  need RESTIC_PASSWORD_FILE
  [[ "$RESTIC_PASSWORD_FILE" == /* && -s "$RESTIC_PASSWORD_FILE" &&
     -f "$RESTIC_PASSWORD_FILE" && ! -L "$RESTIC_PASSWORD_FILE" ]] ||
    fail "Restic password file must be an absolute, existing, non-symlink path"
  local mode
  mode="$(stat -c '%a' "$RESTIC_PASSWORD_FILE")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "Invalid Restic secret file permissions"
  (( (8#$mode & 077) == 0 )) || fail "Restic password file must be mode 600"
  # An encrypted remote target is required; local disk alone cannot meet
  # the offsite acceptance policy. Exact provider/credentials are B operator work.
  case "$RESTIC_REPOSITORY" in
    s3:*|sftp:*|rclone:*|b2:*|azure:*|gs:*) ;;
    *) fail "Offsite Restic repository required (s3/sftp/rclone/b2/azure/gs)" ;;
  esac
  command -v restic >/dev/null || fail "restic CLI is not installed"
}

case "$COMMAND" in
  help|--help|-h) usage ;;
  backup)
    approve
    run_preflight
    [[ "${RCAT_POS_BACKUP_POLICY_APPROVED:-}" == yes ]] ||
      fail "Owner-approved G4 backup policy required"
    restic_preflight
    command -v docker >/dev/null || fail "Docker Compose unavailable"
    [[ "$TOPOLOGY" == portal ]] || compose_cmd config --quiet
    # Check the remote repository is already initialized; never restic init.
    restic snapshots --json --tag "$(snapshot_tag)" >/dev/null 2>&1 ||
      fail "Offsite encrypted Restic repository is not accessible"
    # No plaintext backup is written to host disk or shell history.
    # A failed pg_dump propagates via pipefail and cannot report a successful backup.
    filename="rcat-pos-staging-$(date -u +%Y%m%dT%H%M%SZ).dump"
    tags=(--tag rcat-pos-staging --tag postgres16)
    if [[ "$TOPOLOGY" == portal ]]; then tags+=(--tag rcat-pos-portal); fi
    compose_cmd exec -T postgres sh -eu -c \
      'export PGPASSWORD="$(cat /run/secrets/staging_pg_password)"; exec pg_dump -U rcat_pos_staging_dba -d rcat_pos_staging --format=custom' |
      restic backup --stdin --stdin-filename "$filename" \
        "${tags[@]}" --quiet
    printf 'PASS: encrypted remote snapshot created; restore drill still requires independent verification\n'
    ;;
  backup-check)
    run_preflight
    restic_preflight
    # Do not print snapshot metadata, target URLs, filenames or credentials.
    restic snapshots --json --tag "$(snapshot_tag)" |
      python3 "$ROOT/scripts/ops/onprem-snapshot-freshness.py"
    ;;
  prune-guest-budgets)
    approve
    run_preflight
    [[ "${RCAT_POS_GUEST_RETENTION_APPROVED:-}" == yes ]] ||
      fail "Owner-approved Guest budget retention policy required"
    [[ "$TOPOLOGY" == portal ]] || compose_cmd config --quiet
    # Existing DBA-only CLI deletes EXPIRED Guest HMAC buckets (24h) only.
    # Order, Outbox, audit, inventory, and customer records are untouched.
    compose_cmd --profile ops run --rm budget_maintenance
    ;;
  readiness)
    run_preflight
    command -v node >/dev/null || fail "Node.js runtime unavailable on operator host"
    node "$ROOT/scripts/ops/onprem-readiness.mjs"
    ;;
  *) fail "Unknown action; use help" ;;
esac
