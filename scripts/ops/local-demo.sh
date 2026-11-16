#!/usr/bin/env bash
# One-command local demo. Fixed project/database/loopback ports, no staging env.
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
fail() { echo "LOCAL DEMO: $*" >&2; exit 1; }
usage() { echo 'Usage: bash scripts/ops/local-demo.sh {up|status|stop|credentials|reset --apply}'; }
case "$*" in
  up|status|stop|credentials|'reset --apply') ;;
  *) usage; exit 1 ;;
esac

state="$root/.secrets/local-demo"
env_file="$root/.env.local"
protected_file() {
  [[ -f "$1" && ! -L "$1" && -s "$1" ]] || fail "Missing or unsafe local file: ${1##*/}"
  [[ "$(stat -c %a "$1")" == 600 && "$(stat -c %u "$1")" == "$EUID" ]] ||
    fail "Local files must be owned by the current operator with mode 600"
}
validate_state() {
  [[ -d "$state" && ! -L "$state" && ! -L "$root/.secrets" ]] || fail 'Missing or unsafe local secret directory'
  [[ "$(stat -c %a "$state")" == 700 && "$(stat -c %u "$state")" == "$EUID" ]] || fail 'Local secret directory must have mode 700 and belong to the current operator'
  protected_file "$env_file"
  for name in dba auth tenant admin merchant; do
    protected_file "$state/$name-password"
    [[ "$(cat "$state/$name-password")" =~ ^[0-9a-f]{64}$ ]] || fail 'Malformed local password file'
  done
  protected_file "$state/key.pem"
  protected_file "$state/cert.pem"
  # Keep the generated runtime URLs consistent with the login passwords.
  [[ "$(sed -n 's/^RCAT_LOCAL_AUTH_PASSWORD=//p' "$env_file")" == "$(cat "$state/auth-password")" ]] || fail 'Local auth configuration differs from its secret file'
  [[ "$(sed -n 's/^RCAT_LOCAL_TENANT_PASSWORD=//p' "$env_file")" == "$(cat "$state/tenant-password")" ]] || fail 'Local tenant configuration differs from its secret file'
  [[ "$(sed -n 's/^RCAT_LOCAL_PEPPER=//p' "$env_file")" =~ ^[0-9a-f]{64}$ ]] || fail 'Malformed local pepper'
}

if [[ "$1" == credentials ]]; then
  validate_state
  echo 'admin_demo@demo.invalid (tenant owner):'
  cat "$state/admin-password"
  echo
  echo 'merchant_demo@demo.invalid (store manager):'
  cat "$state/merchant-password"
  exit 0
fi
command -v docker >/dev/null || fail 'Docker with Compose v2 is required'
# Use only this machine's local daemon, never an inherited remote Docker target.
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}
docker_local info >/dev/null 2>&1 || fail 'Cannot access the local Docker daemon'
docker_local compose version >/dev/null || fail 'Docker Compose v2 is required'
release="local-$(git rev-parse --short=12 HEAD)"
c() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    -u RCAT_LOCAL_AUTH_PASSWORD -u RCAT_LOCAL_TENANT_PASSWORD -u RCAT_LOCAL_PEPPER \
    RCAT_LOCAL_RELEASE="$release" COMPOSE_PARALLEL_LIMIT=1 \
    docker --host=unix:///var/run/docker.sock compose --project-directory "$root" \
      --env-file "$env_file" -p rcat-pos-local -f "$root/compose.local.yaml" "$@"
}

if [[ "$1" == reset ]]; then
  # Explicitly destructive ONLY for the fixed, isolated rcat-pos-local project.
  # Never touch .env.portal, staging PostgreSQL, PromptPay, or other Compose volumes.
  [[ "$2" == --apply ]] || fail 'Explicit reset --apply required'
  [[ ! -L "$env_file" && ! -L "$state" && ! -L "$root/.secrets" ]] ||
    fail 'Refusing symlinked local paths'
  if [[ -e "$env_file" ]]; then protected_file "$env_file"; fi
  if [[ -e "$state" ]]; then
    [[ -d "$state" && "$(stat -c %a "$state")" == 700 &&
       "$(stat -c %u "$state")" == "$EUID" ]] ||
      fail 'Unrecognized local secret directory'
    for path in "$state"/*; do
      [[ ! -e "$path" ]] && continue
      [[ -f "$path" && ! -L "$path" ]] || fail 'Unknown local secret path'
      case "\${path##*/}" in
        dba-password|auth-password|tenant-password|admin-password|merchant-password|owner-password|key.pem|cert.pem) ;;
        *) fail 'Local directory contains unknown files; preserving it' ;;
      esac
      protected_file "$path"
    done
  fi
  dbvol=rcat-pos-local_local_postgres_data
  if docker_local volume inspect "$dbvol" >/dev/null 2>&1; then
    project="$(docker_local volume inspect -f '{{ index .Labels "com.docker.compose.project" }}' "$dbvol")"
    name="$(docker_local volume inspect -f '{{ index .Labels "com.docker.compose.volume" }}' "$dbvol")"
    [[ "$project" == rcat-pos-local && "$name" == local_postgres_data ]] ||
      fail 'Volume belongs to another or unrecognized project; refusing deletion'
    [[ -f "$env_file" && -d "$state" ]] ||
      fail 'Local DB exists without protected credentials; refusing deletion'
  fi
  # Only local project containers are stopped. No global prune, no -v flag.
  if [[ -f "$env_file" ]]; then c down --remove-orphans; fi
  if docker_local volume inspect "$dbvol" >/dev/null 2>&1; then
    docker_local volume rm "$dbvol" >/dev/null ||
      fail 'Volume still in use; protected passwords were retained'
    echo 'LOCAL_DEMO_OLD_DATABASE=REMOVED'
  fi
  if [[ -d "$state" ]]; then
    for path in "$state"/*; do
      [[ ! -e "$path" ]] && continue
      rm -- "$path"
    done
    rmdir -- "$state"
  fi
  if [[ -f "$env_file" ]]; then rm -- "$env_file"; fi
  echo 'LOCAL_DEMO_OLD_CREDENTIALS=REMOVED'
  # Re-provision only the local database and distinct scoped demo accounts.
  exec bash "$root/scripts/ops/local-demo.sh" up
fi

if [[ "$1" == up ]]; then
  for cmd in openssl ss git; do command -v "$cmd" >/dev/null || fail "Required command missing: $cmd"; done
  if [[ ! -e "$env_file" && ! -L "$env_file" ]]; then
    [[ ! -e "$state" && ! -L "$state" ]] || fail 'Existing local secrets found; refusing to regenerate credentials'
    if docker_local volume inspect rcat-pos-local_local_postgres_data >/dev/null 2>&1; then
      fail 'Existing demo database found without configuration; restore the original local secret files'
    fi
    [[ ! -L "$root/.secrets" ]] || fail 'Refusing a symlinked .secrets directory'
    mkdir -p "$root/.secrets"
    mkdir -m 700 "$state"
    for name in dba auth tenant admin merchant; do openssl rand -hex 32 > "$state/$name-password"; done
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
      -keyout "$state/key.pem" -out "$state/cert.pem" -subj '/CN=localhost' \
      -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' >/dev/null 2>&1
    {
      printf 'RCAT_LOCAL_AUTH_PASSWORD=%s\n' "$(cat "$state/auth-password")"
      printf 'RCAT_LOCAL_TENANT_PASSWORD=%s\n' "$(cat "$state/tenant-password")"
      printf 'RCAT_LOCAL_PEPPER=%s\n' "$(openssl rand -hex 32)"
    } > "$env_file"
    chmod 600 "$env_file" "$state/"*
  fi
fi
validate_state
case "$1" in
  up)
    openssl x509 -in "$state/cert.pem" -checkend 0 -noout >/dev/null || fail 'Local certificate expired; renew only the local certificate/key before restarting'
    # Validate without printing expanded database credentials.
    c config --quiet
    if [[ -z "$(docker_local ps -q --filter label=com.docker.compose.project=rcat-pos-local)" ]]; then
      for port in 11880; do
        [[ -z "$(ss -H -ltn "( sport = :$port )")" ]] || fail "Port $port is occupied; existing services were left running"
      done
    fi
    c build api customer
    c up -d --wait --wait-timeout 120 postgres
    c run --rm --no-deps migrator
    c run --rm --no-deps seed
    c up -d --remove-orphans --wait --wait-timeout 120 api customer
    echo 'LOCAL_DEMO_READY'
    echo 'Open https://localhost:11880/ through SSH forwarding (see docs/LOCAL-DEMO.md).'
    echo 'Show admin_demo and merchant_demo passwords: sudo bash scripts/ops/local-demo.sh credentials'
    ;;
  status) c ps ;;
  stop) c stop ;;
esac
