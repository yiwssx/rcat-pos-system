#!/usr/bin/env bash
# PostgreSQL-only Single-Origin bootstrap. Google OAuth intentionally deferred.
# Never starts API/web, enables Payment, or changes an existing database schema.
set -euo pipefail
set +x
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
fail() { printf 'POSTGRES_SETUP=BLOCKED %s\n' "$*" >&2; exit 1; }
[[ "$EUID" == 0 ]] || fail 'Run with sudo'
for tool in docker openssl sed; do command -v "$tool" >/dev/null || fail "Missing $tool"; done
[[ -f .env.portal && ! -L .env.portal ]] ||
  bash scripts/ops/g5-payment-prepare.sh >/dev/null
[[ -f .env.portal && ! -L .env.portal ]] || fail 'Protected .env.portal missing'
mode="$(stat -c %a .env.portal)"
[[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail 'Invalid config mode'
(( (8#$mode & 077) == 0 )) || fail 'Config must have mode 600'
[[ "$(stat -c %u .env.portal)" == "$EUID" ]] ||
  fail 'Config must be root-owned for this operator script'
db_file="$(sed -n 's/^RCAT_POS_DB_PASSWORD_FILE=//p' .env.portal | tail -n 1)"
db_file="${db_file#\'}"; db_file="${db_file%\'}"
db_file="${db_file#\"}"; db_file="${db_file%\"}"
[[ "$db_file" == /* && ! -L "$db_file" ]] || fail 'Unsafe DBA secret path'
# Only generate a new DBA password in the explicitly tracked first-install location.
default_dba="$root/.secrets/staging-pg-password"
vol=rcat-pos-staging_staging_postgres_data
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY \
    -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"
}
dc() {
  docker_local compose --project-directory "$root" --env-file "$root/.env.portal" \
    -p rcat-pos-staging -f "$root/compose.portal.yaml" "$@"
}
db_preexisting=false
if docker_local volume inspect "$vol" >/dev/null 2>&1; then db_preexisting=true; fi
if [[ ! -e "$db_file" ]]; then
  [[ "$db_preexisting" == false && "$db_file" == "$default_dba" ]] ||
    fail 'Missing DBA password for existing or external PostgreSQL'
  [[ ! -L "$root/.secrets" ]] || fail 'Unsafe .secrets symlink'
  install -d -m 700 "$root/.secrets"
  openssl rand -hex 32 > "$db_file"
  chmod 600 "$db_file"
  echo 'POSTGRES_SETUP=GENERATED_NEW_DBA_PASSWORD'
fi
[[ -f "$db_file" && -s "$db_file" && ! -L "$db_file" ]] ||
  fail 'DBA password missing or unsafe'
mode="$(stat -c %a "$db_file")"
[[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail 'Invalid DBA secret mode'
(( (8#$mode & 077) == 0 )) || fail 'DBA secret must be mode 600'
dc config --quiet >/dev/null || fail 'Invalid portal Compose config'
running="$(dc ps -q postgres)"
if [[ -z "$running" ]]; then
  dc up -d --wait --wait-timeout 120 postgres >/dev/null ||
    fail 'PostgreSQL startup failed (API and web not started)'
  echo 'POSTGRES_SETUP=POSTGRES_STARTED_ONLY'
else
  echo 'POSTGRES_SETUP=EXISTING_POSTGRES_PRESERVED'
fi
pg() {
  dc exec -T postgres sh -ec '
    export PGPASSWORD="$(cat /run/secrets/staging_pg_password)"
    exec psql -X -q -A -t -v ON_ERROR_STOP=1 \
      -U rcat_pos_staging_dba -d rcat_pos_staging "$@"
  ' sh "$@"
}
if [[ "$db_preexisting" == false ]]; then
  # Migration on a newly created database only. Never migrate an existing volume.
  dc --profile ops run --rm --no-deps migrator >/dev/null ||
    fail 'First-install migration failed; investigate without resetting the volume'
  echo 'POSTGRES_SETUP=FRESH_DATABASE_MIGRATED'
fi
schema_ok="$(pg -c "SELECT CASE WHEN to_regclass('rcat_migrations.applied') IS NOT NULL AND to_regclass('rcat.users') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rcat_auth') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rcat_app') THEN 'yes' ELSE 'no' END")" ||
  fail 'Cannot authenticate DBA or read PostgreSQL state'
[[ "$schema_ok" == yes ]] ||
  fail 'Existing database is not migrated; no automatic migrations against old data'

auth_login=rcat_pos_portal_auth
tenant_login=rcat_pos_portal_tenant
secret_dir="$root/.secrets/portal-postgres"
auth_file="$secret_dir/auth-password"
tenant_file="$secret_dir/tenant-password"
role_count="$(pg -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('$auth_login','$tenant_login')")" ||
  fail 'Cannot inspect runtime roles'
if [[ ! -e "$secret_dir" ]]; then
  [[ "$role_count" == 0 ]] ||
    fail 'Runtime roles exist without managed secret files; operator reconciliation needed'
  [[ ! -L "$root/.secrets" ]] || fail 'Unsafe secrets directory'
  install -d -m 700 "$secret_dir"
  openssl rand -hex 32 > "$auth_file"
  openssl rand -hex 32 > "$tenant_file"
  chmod 600 "$auth_file" "$tenant_file"
  echo 'POSTGRES_SETUP=CREATED_RUNTIME_SECRETS'
fi
[[ -d "$secret_dir" && ! -L "$secret_dir" && -f "$auth_file" && -f "$tenant_file" &&
  ! -L "$auth_file" && ! -L "$tenant_file" ]] ||
  fail 'Incomplete or unsafe managed credentials'
for f in "$auth_file" "$tenant_file"; do
  [[ "$(stat -c %a "$f")" == 600 && "$(stat -c %u "$f")" == "$EUID" ]] ||
    fail 'Runtime credentials must be root-owned mode 600'
  [[ "$(cat "$f")" =~ ^[0-9a-f]{64}$ ]] || fail 'Invalid runtime credential'
done
auth_password="$(cat "$auth_file")"
tenant_password="$(cat "$tenant_file")"
auth_url="postgresql://$auth_login:$auth_password@postgres:5432/rcat_pos_staging"
tenant_url="postgresql://$tenant_login:$tenant_password@postgres:5432/rcat_pos_staging"
# No silent replacement of an independently configured real database connection.
for pair in AUTH_DATABASE_URL TENANT_DATABASE_URL; do
  current="$(sed -n "s/^$pair=//p" .env.portal | tail -n 1)"
  if [[ "$pair" == AUTH_DATABASE_URL ]]; then expected="'$auth_url'"
  else expected="'$tenant_url'"; fi
  if [[ "$current" != "$expected" && -n "$current" &&
        "$current" != *REPLACE* && "$current" != *AUTH_LOGIN* &&
        "$current" != *TENANT_LOGIN* ]]; then
    fail "$pair already set to another concrete credential; refusing overwrite"
  fi
done

# Passwords stream over stdin to the isolated container, never in argv or logs.
# Existing roles are not modified. New role grants are limited to rcat_auth/rcat_app.
{
  printf '\\set g5_auth_password %s\n' "$auth_password"
  printf '\\set g5_tenant_password %s\n' "$tenant_password"
  cat <<'SQL'
BEGIN;
SELECT CASE WHEN NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname='rcat_pos_portal_auth')
  THEN format('CREATE ROLE rcat_pos_portal_auth LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'g5_auth_password')
END \gexec
SELECT CASE WHEN NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname='rcat_pos_portal_tenant')
  THEN format('CREATE ROLE rcat_pos_portal_tenant LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'g5_tenant_password')
END \gexec
GRANT rcat_auth TO rcat_pos_portal_auth;
GRANT rcat_app TO rcat_pos_portal_tenant;
DO $role_check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles
      WHERE rolname IN ('rcat_pos_portal_auth','rcat_pos_portal_tenant')
        AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
             OR rolinherit OR rolreplication OR NOT rolcanlogin))
     OR NOT pg_has_role('rcat_pos_portal_auth','rcat_auth','MEMBER')
     OR NOT pg_has_role('rcat_pos_portal_tenant','rcat_app','MEMBER')
  THEN RAISE EXCEPTION 'PostgreSQL runtime role isolation failed'; END IF;
END $role_check$;
COMMIT;
SQL
} | pg >/dev/null || fail 'Runtime role provisioning failed'

# Preserve every unrelated setting; never create or modify Google credentials.
temp_env="$(mktemp "$root/.env.portal.XXXXXXXX")"
trap 'rm -f "$temp_env"' EXIT
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    AUTH_DATABASE_URL=*) printf "AUTH_DATABASE_URL='%s'\n" "$auth_url" ;;
    TENANT_DATABASE_URL=*) printf "TENANT_DATABASE_URL='%s'\n" "$tenant_url" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < .env.portal > "$temp_env"
chmod 600 "$temp_env"
chown --reference=.env.portal "$temp_env"
mv -f "$temp_env" .env.portal
trap - EXIT
unset auth_password tenant_password auth_url tenant_url
echo 'POSTGRES_SETUP=READY'
echo 'DATABASE_LOGINS=SEPARATE_RESTRICTED_AUTH_AND_TENANT'
echo 'GOOGLE_OAUTH=PENDING_BY_OWNER_DECISION'
echo 'API_WEB=NOT_STARTED PAYMENT=NOT_ENABLED'
