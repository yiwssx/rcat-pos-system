#!/usr/bin/env bash
# RCAT POS On-prem STAGING: operator tools only, no automatic scheduling.
# Never executes destructive Outbox/Order maintenance or database restores.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${RCAT_POS_ENV_FILE:-$ROOT/.env.staging}"
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
Requires RCAT_POS_ENV_FILE, onprem-staging.sh preflight, and prior operator policy approval.
No Order/Outbox pruning, destructive restores, Payment or Production permitted.
HELP
}

fail() { printf 'STAGING OPERATIONS DENIED: %s\n' "$*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || fail "Missing $1"; }
approve() { [[ "$APPROVAL" == "--apply" ]] || fail "--apply required"; }
run_preflight() {
  bash "$ROOT/scripts/ops/onprem-staging.sh" preflight >/dev/null
  # The 0600 env file is operator-controlled, validated by preflight.
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  [[ "${RCAT_POS_ENVIRONMENT:-}" == staging ]] || fail "Only staging may be operated"
}
compose_cmd() {
  docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" -f "$ROOT/compose.staging.yaml" "$@"
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
    compose_cmd config --quiet
    # Check the remote repository is already initialized; never restic init.
    restic snapshots --json --tag rcat-pos-staging >/dev/null ||
      fail "Offsite encrypted Restic repository is not accessible"
    # No plaintext backup is written to host disk or shell history.
    # A failed pg_dump propagates via pipefail and cannot report a successful backup.
    filename="rcat-pos-staging-$(date -u +%Y%m%dT%H%M%SZ).dump"
    compose_cmd exec -T postgres sh -eu -c \
      'export PGPASSWORD="$(cat /run/secrets/staging_pg_password)"; exec pg_dump -U rcat_pos_staging_dba -d rcat_pos_staging --format=custom' |
      restic backup --stdin --stdin-filename "$filename" \
        --tag rcat-pos-staging --tag postgres16 --quiet
    printf 'PASS: encrypted remote snapshot created; restore drill still requires independent verification\n'
    ;;
  backup-check)
    run_preflight
    restic_preflight
    # Do not print snapshot metadata, target URLs, filenames or credentials.
    restic snapshots --json --tag rcat-pos-staging |
      python3 "$ROOT/scripts/ops/onprem-snapshot-freshness.py"
    ;;
  prune-guest-budgets)
    approve
    run_preflight
    [[ "${RCAT_POS_GUEST_RETENTION_APPROVED:-}" == yes ]] ||
      fail "Owner-approved Guest budget retention policy required"
    compose_cmd config --quiet
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
