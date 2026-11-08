#!/usr/bin/env bash
# RCAT POS G4 non-payment staging only. Does not auto-run or touch a live host.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${RCAT_POS_ENV_FILE:-$ROOT/.env.staging}"
COMPOSE="$ROOT/compose.staging.yaml"
command="${1:-help}"
approval="${2:-}"

usage() {
  cat <<'HELP'
RCAT On-prem Staging: operator-only, no automatic deployment.
  onprem-staging.sh preflight              # offline input and permission checks
  onprem-staging.sh config                 # validate Compose without printing secrets
  onprem-staging.sh build --apply          # build tagged images, no deploy
  onprem-staging.sh migrate --apply        # explicit privileged SQL migrations
  onprem-staging.sh deploy --apply         # start staging services from built images
  onprem-staging.sh verify                 # health and DB readiness via local ports
  onprem-staging.sh rollback --apply TAG   # old app images only; requires approved schema
Environment: RCAT_POS_ENV_FILE (defaults to .env.staging in repository root).
NEVER run against Production or a real-payment environment.
HELP
}

fail() { printf 'STAGING PREFLIGHT FAILED: %s\n' "$*" >&2; exit 1; }
need() { [[ -n "${!1:-}" ]] || fail "Missing required ${1}"; }
valid_tag() { [[ "$1" =~ ^[a-z0-9][a-z0-9._-]{0,62}$ ]] && [[ "$1" != *production* ]] && [[ "$1" != *latest* ]]; }

preflight() {
  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "Missing protected env file or symlink refused"
  local mode
  mode="$(stat -c '%a' "$ENV_FILE")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "Invalid env permissions"
  (( (8#$mode & 077) == 0 )) || fail "Env file must have no group/other permissions (chmod 600)"
  # This file is operator-controlled shell syntax, NOT an untrusted dotenv parser.
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  [[ "${RCAT_POS_ENVIRONMENT:-}" == staging ]] || fail "Only staging is supported"
  [[ "${RCAT_POS_HOST_BIND_IP:-}" == "127.0.0.1" ||
     "${RCAT_POS_HOST_BIND_IP:-}" == "10.10.1.100" ]] ||
    fail "Bind only to loopback or approved IOT LAN IP; never 0.0.0.0"
  need RCAT_POS_RELEASE
  valid_tag "$RCAT_POS_RELEASE" || fail "Invalid/unsafe staging release tag"
  [[ "${ENABLE_DEVELOPMENT_AUTH:-false}" != true ]] || fail "Development password login prohibited"
  [[ "${ENABLE_REGISTRATION_TEST_MODE:-false}" != true &&
     "${ENABLE_RECOVERY_TEST_MODE:-false}" != true ]] || fail "Test auth/recovery prohibited"

  need RCAT_POS_DB_PASSWORD_FILE
  [[ "$RCAT_POS_DB_PASSWORD_FILE" == /* ]] || fail "DBA password file must use an absolute path"
  [[ -f "$RCAT_POS_DB_PASSWORD_FILE" && ! -L "$RCAT_POS_DB_PASSWORD_FILE" ]] ||
    fail "Missing DBA password file or symlink refused"
  mode="$(stat -c '%a' "$RCAT_POS_DB_PASSWORD_FILE")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "Invalid DBA file permissions"
  (( (8#$mode & 077) == 0 )) || fail "DBA password file must be mode 600"
  [[ -s "$RCAT_POS_DB_PASSWORD_FILE" ]] || fail "Empty DBA password file"

  local i j ports=()
  for i in RCAT_POS_CUSTOMER_PORT RCAT_POS_MERCHANT_PORT RCAT_POS_ADMIN_PORT; do
    need "$i"
    [[ "${!i}" =~ ^[0-9]{4,5}$ ]] || fail "Invalid port in $i"
    (( ${!i} >= 1024 && ${!i} <= 65535 )) || fail "Port out of range in $i"
    for j in "${ports[@]}"; do [[ "$j" != "${!i}" ]] || fail "Duplicate published port"; done
    ports+=("${!i}")
  done

  for i in AUTH_DATABASE_URL TENANT_DATABASE_URL AUTH_ALLOWED_ORIGINS CORS_ORIGINS \
           GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_REDIRECT_URI \
           GUEST_TABLE_CODE_PEPPER GUEST_ORDER_BASE_URL; do
    need "$i"
  done
  [[ "$AUTH_DATABASE_URL" != "$TENANT_DATABASE_URL" ]] ||
    fail "Auth and tenant runtime DB identities must be different"
  [[ "$AUTH_DATABASE_URL" =~ ^postgres(ql)?:// && "$TENANT_DATABASE_URL" =~ ^postgres(ql)?:// ]] ||
    fail "PostgreSQL connection URLs required"
  [[ "$GOOGLE_OAUTH_REDIRECT_URI" == https://* && "$GUEST_ORDER_BASE_URL" == https://* ]] ||
    fail "HTTPS callback and customer URL required"
  [[ "$AUTH_ALLOWED_ORIGINS" == https://* && "$CORS_ORIGINS" == https://* &&
    "$AUTH_ALLOWED_ORIGINS" != *'*'* && "$CORS_ORIGINS" != *'*'* ]] ||
    fail "Exact HTTPS origins required, never wildcard CORS"
  [[ "$GUEST_TABLE_CODE_PEPPER" =~ ^[0-9a-fA-F]{64}$ ]] ||
    fail "Guest pepper must be unique 32-byte hex"
  printf 'PASS: safe staging input checks (no secrets printed)\n'
}

compose_cmd() {
  docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" -f "$COMPOSE" "$@"
}

approved() {
  [[ "$approval" == "--apply" ]] || fail "Explicit --apply required for mutable action"
}

case "$command" in
  help|--help|-h) usage ;;
  preflight) preflight ;;
  config)
    preflight
    compose_cmd config --quiet
    printf 'PASS: Docker Compose staging configuration validated (secrets withheld)\n'
    ;;
  build)
    approved
    preflight
    compose_cmd config --quiet
    compose_cmd build --pull api customer merchant admin
    ;;
  migrate)
    approved
    preflight
    compose_cmd config --quiet
    compose_cmd --profile ops run --rm migrator
    ;;
  deploy)
    approved
    preflight
    compose_cmd config --quiet
    compose_cmd up -d --no-build --wait postgres api customer merchant admin
    ;;
  verify)
    preflight
    local_base="http://$RCAT_POS_HOST_BIND_IP"
    for port in "$RCAT_POS_CUSTOMER_PORT" "$RCAT_POS_MERCHANT_PORT" "$RCAT_POS_ADMIN_PORT"; do
      curl --fail --silent --show-error --max-time 10 --output /dev/null "$local_base:$port/"
      curl --fail --silent --show-error --max-time 10 --output /dev/null "$local_base:$port/api/health"
      curl --fail --silent --show-error --max-time 10 --output /dev/null "$local_base:$port/api/ready"
    done
    printf 'PASS: all three local staging origins and PostgreSQL-backed readiness\n'
    ;;
  rollback)
    approved
    preflight
    target="${3:-}"
    [[ -n "$target" ]] && valid_tag "$target" || fail "Provide a safe prior release tag"
    [[ "$target" != "$RCAT_POS_RELEASE" ]] || fail "Cannot rollback to the current release"
    [[ "${RCAT_POS_ROLLBACK_SCHEMA_APPROVED:-}" == yes ]] ||
      fail "Explicit operator DB schema compatibility approval required"
    for service in api customer merchant admin; do
      docker image inspect "rcat-pos-$service:$target" >/dev/null ||
        fail "Image for $service:$target not present, refusing partial rollback"
    done
    RCAT_POS_RELEASE="$target" compose_cmd up -d --no-build --no-deps api customer merchant admin
    printf 'Rolled back app images ONLY. PostgreSQL was not rolled back. Run verify and external HTTPS tests.\n'
    ;;
  *) fail "Unknown command; use help" ;;
esac
