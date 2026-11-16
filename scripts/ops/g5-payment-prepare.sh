#!/usr/bin/env bash
# Idempotent, local-only Payment configuration preparation for the single-origin portal.
# IMPORTANT: this is not a real-money enablement or an authorized deploy.
set -euo pipefail
set +x
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
env_file="$root/.env.portal"
example="$root/.env.portal.example"

fail() { printf 'PAYMENT_PREPARE=BLOCKED %s\n' "$*" >&2; exit 1; }
[[ "$EUID" == 0 ]] || fail 'Run with sudo (protected configuration only)'
[[ -f "$example" && ! -L "$example" ]] || fail 'Missing tracked portal template'
command -v openssl >/dev/null || fail 'openssl missing'
command -v git >/dev/null || fail 'git missing'

if [[ -L "$env_file" ]]; then
  fail 'Refusing symlinked .env.portal'
elif [[ ! -e "$env_file" ]]; then
  # Never derive fresh production credentials from a local demo or legacy staging.
  install -o root -g root -m 600 "$example" "$env_file"
  source_sha="$(git rev-parse --short=12 HEAD)"
  pepper="$(openssl rand -hex 32)"
  sed -i \
    -e "s|^RCAT_POS_RELEASE=.*|RCAT_POS_RELEASE=staging-$source_sha|" \
    -e "s|^GUEST_TABLE_CODE_PEPPER=.*|GUEST_TABLE_CODE_PEPPER=$pepper|" \
    "$env_file"
  unset pepper
  echo 'PAYMENT_PREPARE=CREATED_PROTECTED_TEMPLATE'
else
  [[ -f "$env_file" ]] || fail 'Existing portal config is not a regular file'
  echo 'PAYMENT_PREPARE=PRESERVED_EXISTING_CONFIG'
fi

mode="$(stat -c %a "$env_file")"
[[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail 'Invalid .env.portal mode'
(( (8#$mode & 077) == 0 )) || fail '.env.portal must be chmod 600'
# A root operator may inspect either a protected root- or original operator-owned file.
[[ -s "$env_file" ]] || fail 'Empty .env.portal'

missing=""
for key in AUTH_DATABASE_URL TENANT_DATABASE_URL GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
  value="$(sed -n "s/^$key=//p" "$env_file" | tail -n 1)"
  case "$value" in
    ''|*REPLACE*|*AUTH_LOGIN*|*TENANT_LOGIN*)
      missing="$missing $key";;
  esac
done
db_file="$(sed -n 's/^RCAT_POS_DB_PASSWORD_FILE=//p' "$env_file" | tail -n 1)"
db_file="$(printf '%s' "$db_file" | tr -d "'\"")"
if [[ "$db_file" != /* || ! -f "$db_file" || -L "$db_file" || ! -s "$db_file" ]]; then
  missing="$missing RCAT_POS_DB_PASSWORD_FILE"
fi

if [[ -n "$missing" ]]; then
  echo "PAYMENT_PREPARE=ACTION_REQUIRED"
  echo "Missing real operator-owned configuration keys:$missing"
  echo "Edit locally: sudoedit $env_file"
  echo 'PAYMENT_QR=OFF PAYMENT_SLIP=OFF REAL_MONEY=NOT_ENABLED'
  exit 0
fi

command -v docker >/dev/null || fail 'Docker missing'
# Only parse config; never build/migrate/deploy/enable a bank account.
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY \
  -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock \
  compose --project-directory "$root" --env-file "$env_file" \
  -p rcat-pos-staging -f "$root/compose.portal.yaml" config --quiet \
  >/dev/null || fail 'Portal Compose configuration is not valid'

echo 'PAYMENT_PREPARE=CONFIG_SYNTAX_OK'
echo 'PAYMENT_RELEASE=STILL_REQUIRES_REAL_HOST_HTTPS_BACKUP_RECEIVER_AND_G6'
echo 'REAL_MONEY=NOT_ENABLED_BY_THIS_SCRIPT'
