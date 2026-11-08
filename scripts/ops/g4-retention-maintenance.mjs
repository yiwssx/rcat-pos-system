#!/usr/bin/env node
// Operator-only G4 maintenance. Read-only reporting by default.
// Destructive Order/Outbox pruning is intentionally NOT implemented.
import process from "node:process";

const usage = [
  "RCAT POS G4 maintenance (DBA or dedicated maintenance role only)",
  "Usage: node scripts/ops/g4-retention-maintenance.mjs report",
  "       node scripts/ops/g4-retention-maintenance.mjs prune-guest-budgets --apply",
  "Requires standard PGHOST, PGDATABASE, PGUSER and PG password/service config.",
  "Production prune additionally requires --production-approved.",
  "Never use AUTH_DATABASE_URL or TENANT_DATABASE_URL runtime credentials.",
].join("\n");

function validate(args, env) {
  const [action, ...flags] = args;
  if (action === "--help" || action === "help") return { help: true };
  if (!["report", "prune-guest-budgets"].includes(action)) {
    throw new Error("Unknown action. " + usage);
  }
  if (flags.some((x) => !["--apply", "--production-approved"].includes(x))) {
    throw new Error("Unknown option");
  }
  if (action === "prune-guest-budgets" && !flags.includes("--apply")) {
    throw new Error("Pruning requires an explicit --apply flag");
  }
  if (
    action === "prune-guest-budgets" &&
    env.NODE_ENV === "production" &&
    !flags.includes("--production-approved")
  ) {
    throw new Error("Production pruning requires operator approval");
  }
  for (const name of ["PGHOST", "PGDATABASE", "PGUSER"]) {
    if (!env[name]) throw new Error(name + " is required for DBA maintenance");
  }
  if (env.PGDATABASE === "rcat_ci_test" && env.CI !== "true") {
    throw new Error("CI test database requires explicit CI=true");
  }
  return { action };
}

async function run() {
  const config = validate(process.argv.slice(2), process.env);
  if (config.help) {
    process.stdout.write(usage + "\n");
    return;
  }
  const { Client } = (await import("pg")).default;
  // pg uses the existing PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
  // environment; no app connection string or secret is printed.
  const db = new Client({ connectionTimeoutMillis: 5000 });
  try {
    await db.connect();
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout = '10000ms'");
    await db.query("SET LOCAL lock_timeout = '2000ms'");
    if (config.action === "report") {
      await db.query("SET TRANSACTION READ ONLY");
      const guest = await db.query(
        "SELECT count(*)::bigint AS buckets, " +
          "count(*) FILTER (WHERE window_started < clock_timestamp()-interval '1 day')::bigint AS expired, " +
          "min(window_started) AS oldest_at " +
          "FROM rcat_private.guest_request_budgets",
      );
      const outbox = await db.query(
        "SELECT tenant_id,store_id,event_count,older_than_30_days," +
          "events_after_slowest_recorded_ack " +
          "FROM rcat_private.order_outbox_retention_preview " +
          "ORDER BY older_than_30_days DESC,tenant_id,store_id LIMIT 100",
      );
      await db.query("COMMIT");
      process.stdout.write(
        JSON.stringify({
          mode: "read_only",
          guestBudgets: guest.rows[0],
          outbox: {
            topStores: outbox.rows,
            reportedStores: outbox.rowCount,
            note: "Outbox is NOT pruned; recorded cursors are not proof of offline delivery",
          },
        }) + "\n",
      );
      return;
    }
    // Definer function has NO runtime-role grants; a privileged operator
    // still must explicitly approve the operation and configure a scheduler.
    const lock = await db.query(
      "SELECT pg_try_advisory_xact_lock(4261,2026) AS acquired",
    );
    if (!lock.rows[0]?.acquired) {
      throw new Error("Another budget maintenance task holds the lock");
    }
    const removed = await db.query(
      "SELECT rcat_private.prune_guest_request_budgets() AS removed",
    );
    await db.query("COMMIT");
    process.stdout.write(
      JSON.stringify({
        mode: "guest_budget_prune",
        removedExpiredBuckets: removed.rows[0]?.removed,
        outboxDeleted: false,
      }) + "\n",
    );
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
}
run().catch((error) => {
  // Error messages must not include a connection string or driver options.
  // Only print curated local validation errors; DB driver errors might
  // contain connection information or privileged query details.
  const safe = /^(Unknown action|Unknown option|Pruning requires|Production pruning requires|PGHOST|PGDATABASE|PGUSER|CI test database requires|Another budget maintenance task)/.test(
    String(error.message),
  );
  process.stderr.write(
    "G4 maintenance failed: " +
      (safe ? String(error.message) : "Database operation failed; inspect restricted operator logs") +
      "\n",
  );
  process.exitCode = 1;
});
