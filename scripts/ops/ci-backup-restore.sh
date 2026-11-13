#!/usr/bin/env bash
# Destructive CI-only recovery qualification. Never execute on Staging/Production.
set -euo pipefail
if [[ "${CI:-}" != "true" || "${PGDATABASE:-}" != "rcat_ci_test" ||
      "${PGHOST:-}" != "127.0.0.1" || "${PGPORT:-5432}" != "5432" ||
      "${PGUSER:-}" != "postgres" ]]; then
  echo "Refusing backup/restore outside disposable loopback PostgreSQL 16 CI" >&2
  exit 1
fi
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_db="rcat_ci_test"
restore_db="rcat_ci_restore"
work="$(mktemp -d)"
trap 'rm -rf "$work"; dropdb --if-exists --force "$restore_db" >/dev/null 2>&1 || true' EXIT

# Use PostgreSQL 16 native dump/restore clients against the PostgreSQL 16
# ephemeral service. Ubuntu runner may ship a newer client that emits server
# settings (e.g. transaction_timeout) unsupported by 16.
pg16() {
  docker run --rm --network host --mount "type=bind,src=$work,dst=$work" \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE \
    postgres:16-alpine "$@"
}

# Avoid data in logs. A custom archive retains schema, ACLs, functions,
# session/Outbox records, sequences and migration checksums.
pg16 pg_dump --format=custom --file="$work/snapshot.dump" --dbname="$source_db"
test -s "$work/snapshot.dump"
pg16 pg_restore --list "$work/snapshot.dump" > "$work/toc.txt"
grep -q 'rcat_migrations' "$work/toc.txt"
grep -q 'order_outbox_events' "$work/toc.txt"
createdb --template=template0 "$restore_db"
pg16 pg_restore --exit-on-error --dbname="$restore_db" "$work/snapshot.dump"

# Every persistent row in every tenant, private and migration table is
# compared in canonical JSONB order. Row count + digest catches lost/altered
# Orders, Outbox events, inventory, identities, secrets and audit records
# without printing the records or secrets.
mapfile -t tables < <(
  psql -X -qAt --dbname="$source_db" -v ON_ERROR_STOP=1 -c "
    SELECT format('%I.%I', n.nspname, c.relname)
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('rcat','rcat_private','rcat_migrations')
      AND c.relkind IN ('r','p')
      AND NOT c.relispartition
    ORDER BY 1")
if (( ${#tables[@]} < 15 )); then
  echo 'Unexpectedly few database tables in recovery snapshot' >&2
  exit 1
fi
for db in "$source_db" "$restore_db"; do
  out="$work/$db.txt"
  : > "$out"
  for table in "${tables[@]}"; do
    fp="$(psql -X -qAt --dbname="$db" -v ON_ERROR_STOP=1 -c "
      SELECT count(*)::text || ':' ||
        md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY
          md5(to_jsonb(t)::text)), ''))
      FROM $table AS t")"
    printf '%s|%s\n' "$table" "$fp" >> "$out"
  done
done
diff -u "$work/$source_db.txt" "$work/$restore_db.txt"

# Replaying the complete migration manifest must skip all unchanged
# checksummed migrations; a missing or modified ledger causes an error.
PGDATABASE="$restore_db" bash "$ROOT/scripts/db/migrate.sh" > "$work/migrate-verify.log"
latest="$(find "$ROOT/db/migrations" -maxdepth 1 -name '[0-9][0-9][0-9]_*.sql' -printf '%f\n' | sort | tail -n 1)"
test -n "$latest"
grep -Fq "Skipping unchanged migration $latest" "$work/migrate-verify.log"
expected_migrations="$(find "$ROOT/db/migrations" -maxdepth 1 -name '[0-9][0-9][0-9]_*.sql' | wc -l | tr -d '[:space:]')"
PGDATABASE="$restore_db" psql -X -v ON_ERROR_STOP=1 \
  -v "expected_migrations=$expected_migrations" \
  -f "$ROOT/tests/db/g4-restored-integrity.sql"
echo "PASS: pg_dump/pg_restore parity for ${#tables[@]} persisted tables, checksummed migrations, staff replay and RLS"
