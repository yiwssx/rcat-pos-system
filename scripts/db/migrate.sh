#!/usr/bin/env bash
# Migration runner: fails on changed checksums and commits DDL+ledger atomically.
set -euo pipefail
: "${PGDATABASE:?PGDATABASE must name an explicit database}"
: "${PGUSER:?PGUSER must be a migration role}"
if [[ "$PGUSER" == rcat_app ]]; then
  echo 'Refusing to migrate as application role' >&2
  exit 1
fi
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS rcat_migrations;
REVOKE ALL ON SCHEMA rcat_migrations FROM PUBLIC;
CREATE TABLE IF NOT EXISTS rcat_migrations.applied (
  version text PRIMARY KEY,
  checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL
shopt -s nullglob
migrations=("$root"/db/migrations/[0-9][0-9][0-9]_*.sql)
if (( ${#migrations[@]} == 0 )); then echo 'No migrations found' >&2; exit 1; fi
for file in "${migrations[@]}"; do
  name="$(basename "$file")"
  if [[ ! "$name" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ ]]; then
    echo "Unexpected migration filename: $name" >&2; exit 1
  fi
  sum="$(sha256sum "$file" | cut -d' ' -f1)"
  prev="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT checksum FROM rcat_migrations.applied WHERE version='$name'")"
  if [[ -n "$prev" ]]; then
    if [[ "$prev" != "$sum" ]]; then
      echo "MIGRATION DRIFT for $name: previously applied file differs" >&2; exit 1
    fi
    echo "Skipping unchanged migration $name"; continue
  fi
  echo "Applying $name"
  psql -X -v ON_ERROR_STOP=1 --single-transaction -f "$file" -c "INSERT INTO rcat_migrations.applied(version,checksum) VALUES ('$name','$sum')"
done
