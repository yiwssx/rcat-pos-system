import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ops = root + "/scripts/ops/onprem-operations.sh";
const readiness = root + "/scripts/ops/onprem-readiness.mjs";
const snapshot = root + "/scripts/ops/onprem-snapshot-freshness.py";

function execute(command, args, env = {}, input) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    input,
    timeout: 12_000,
  });
}

async function executeNode(script, env) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => (stdout += data));
  child.stderr.on("data", (data) => (stderr += data));
  const [status] = await once(child, "close");
  return { status, stdout, stderr };
}

test("backups and privileged retention never run without explicit --apply", () => {
  const help = execute("bash", [ops, "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not install schedulers|no automatic scheduling/i);
  const backup = execute("bash", [ops, "backup"]);
  assert.notEqual(backup.status, 0);
  assert.match(backup.stderr, /--apply required/);
  const pruning = execute("bash", [ops, "prune-guest-budgets"]);
  assert.notEqual(pruning.status, 0);
  assert.match(pruning.stderr, /--apply required/);
  assert.doesNotMatch(backup.stderr + pruning.stderr, /postgresql:\/\//);
  const shell = execute("bash", ["-n", ops]);
  assert.equal(shell.status, 0, shell.stderr);
});

test("backup timer example matches approved Bangkok 12-hour cadence but remains uninstalled", () => {
  const timer = readFileSync(root + "/infra/onprem/systemd/rcat-pos-staging-backup.timer.example", "utf8");
  assert.match(timer, /UNINSTALLED EXAMPLE/);
  assert.match(timer, /OnCalendar=\*-\*-\* 00:00:00 Asia\/Bangkok/);
  assert.match(timer, /OnCalendar=\*-\*-\* 12:00:00 Asia\/Bangkok/);
  assert.doesNotMatch(timer, /ExecStart=|restic forget|restic prune/);
});

test("snapshot freshness requires tagged, current Restic backups", () => {
  const now = new Date().toISOString();
  const good = execute("python3", [snapshot], {}, JSON.stringify([
    { time: now, tags: ["rcat-pos-staging", "postgres16"] },
  ]));
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).status, "fresh");
  const missing = execute("python3", [snapshot], {}, JSON.stringify([
    { time: now, tags: ["another-store"] },
  ]));
  assert.notEqual(missing.status, 0);
  const old = execute("python3", [snapshot], {}, JSON.stringify([
    { time: "2020-01-01T01:00:00Z", tags: ["rcat-pos-staging"] },
  ]));
  assert.notEqual(old.status, 0);
  const threshold = execute("python3", [snapshot], { RCAT_POS_BACKUP_MAX_AGE_HOURS: "0" },
    JSON.stringify([{ time: now, tags: ["rcat-pos-staging"] }]));
  assert.notEqual(threshold.status, 0);
});

test("staging readiness probe checks all origins, rejects paid mode and hides raw addresses", async () => {
  const servers = [];
  const ports = [];
  for (let i = 0; i < 3; i += 1) {
    const server = createServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html></html>");
      } else if (request.url === "/api/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          service: "rcat-pos-api", healthy: true, paymentEnabled: false, productionReady: false,
        }));
      } else if (request.url === "/api/ready") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          service: "rcat-pos-api", status: "ready", paymentEnabled: false, productionReady: false,
        }));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    servers.push(server);
    ports.push(server.address().port);
  }
  try {
    const env = {
      RCAT_POS_ENVIRONMENT: "staging",
      RCAT_POS_HOST_BIND_IP: "127.0.0.1",
      RCAT_POS_CUSTOMER_PORT: String(ports[0]),
      RCAT_POS_MERCHANT_PORT: String(ports[1]),
      RCAT_POS_ADMIN_PORT: String(ports[2]),
    };
    const good = await executeNode(readiness, env);
    assert.equal(good.status, 0, good.stderr);
    const report = JSON.parse(good.stdout);
    assert.equal(report.status, "ready");
    assert.equal(report.failedChecks, 0);
    assert.equal(report.checks.length, 3);
    assert.ok(!good.stdout.includes("127.0.0.1"));

    const portal = await executeNode(readiness, {
      ...env, RCAT_POS_TOPOLOGY: "portal",
      RCAT_POS_MERCHANT_PORT: "", RCAT_POS_ADMIN_PORT: "",
    });
    assert.equal(portal.status, 0, portal.stderr);
    assert.equal(JSON.parse(portal.stdout).checks.length, 1);
    assert.equal(JSON.parse(portal.stdout).status, "ready");
    const unknown = await executeNode(readiness, { ...env, RCAT_POS_TOPOLOGY: "unknown" });
    assert.notEqual(unknown.status, 0);

    const invalid = await executeNode(readiness, { ...env, RCAT_POS_HOST_BIND_IP: "0.0.0.0" });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /configuration invalid/);
  } finally {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  }
});

test("portal operations use explicit local project and require protected backup approval", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "rcat-portal-ops-"));
  try {
    const protectedEnv = resolve(dir, ".env.portal");
    const dba = resolve(dir, "dba");
    const resticPassword = resolve(dir, "restic-password");
    const log = resolve(dir, "mock.log");
    writeFileSync(dba, "synthetic-dba-test", { mode: 0o600 });
    writeFileSync(resticPassword, "synthetic-restic-test", { mode: 0o600 });
    // Stub all mutable tools: no Docker daemon, external network or database.
    writeFileSync(resolve(dir, "docker"), '#!/bin/sh\nprintf "docker %s\\n" "$*" >> "$MOCK_LOG"\ncase "$*" in *"exec -T postgres"*) printf "synthetic-archive";; esac\n', { mode: 0o700 });
    writeFileSync(resolve(dir, "restic"), '#!/bin/sh\nprintf "restic %s\\n" "$*" >> "$MOCK_LOG"\ncase "$1" in snapshots) printf "[]";; backup) cat >/dev/null;; *) exit 1;; esac\n', { mode: 0o700 });
    const cfg = [
      "RCAT_POS_PUBLIC_ORIGIN=https://pos.example.invalid",
      "RCAT_POS_HOST_BIND_IP=127.0.0.1",
      "RCAT_POS_CUSTOMER_PORT=11890",
      "RCAT_POS_DB_PASSWORD_FILE=" + dba,
      "AUTH_DATABASE_URL=postgresql://auth:fixture@postgres/db",
      "TENANT_DATABASE_URL=postgresql://tenant:fixture@postgres/db",
      "RESTIC_REPOSITORY=sftp:synthetic-invalid:/backup",
      "RESTIC_PASSWORD_FILE=" + resticPassword,
    ].join("\n") + "\n";
    writeFileSync(protectedEnv, cfg, { mode: 0o600 });
    const env = {
      RCAT_POS_TOPOLOGY: "portal", RCAT_POS_ENV_FILE: protectedEnv,
      RCAT_POS_ENVIRONMENT: "staging", RCAT_POS_BACKUP_POLICY_APPROVED: "yes",
      MOCK_LOG: log, PATH: dir + ":" + process.env.PATH,
    };
    // The inherited approval must not turn on the protected Portal policy.
    const denied = execute("bash", [ops, "backup", "--apply"], env);
    assert.notEqual(denied.status, 0, denied.stdout);
    assert.match(denied.stderr, /Owner-approved G4 backup policy required/);
    assert.doesNotMatch(readFileSync(log, "utf8"), /restic|exec -T postgres/);
    writeFileSync(protectedEnv, cfg + "RCAT_POS_BACKUP_POLICY_APPROVED=yes\n");
    const permitted = execute("bash", [ops, "backup", "--apply"], env);
    assert.equal(permitted.status, 0, permitted.stderr);
    const trace = readFileSync(log, "utf8");
    assert.match(trace, /--host=unix:\/\/\/var\/run\/docker\.sock compose/);
    assert.match(trace, /-p rcat-pos-staging -f .*compose\.portal\.yaml/);
    assert.doesNotMatch(trace, /compose\.staging\.yaml/);
    assert.match(trace, /exec -T postgres/);
    assert.match(trace, /snapshots --json --tag rcat-pos-staging,rcat-pos-portal,postgres16/);
    assert.match(trace, /backup --stdin .*--tag rcat-pos-portal/);
    const before = trace;
    writeFileSync(protectedEnv, cfg + "RCAT_POS_BACKUP_POLICY_APPROVED=yes\nRCAT_POS_PAYMENT_QR_RELEASE_APPROVED=true\n");
    const payment = execute("bash", [ops, "backup", "--apply"], env);
    assert.notEqual(payment.status, 0, payment.stdout);
    assert.match(payment.stderr, /non-payment configuration/);
    assert.equal(readFileSync(log, "utf8"), before);
    chmodSync(protectedEnv, 0o644);
    const exposed = execute("bash", [ops, "backup", "--apply"], env);
    assert.notEqual(exposed.status, 0);
    assert.match(exposed.stderr, /mode 600/);
    assert.equal(readFileSync(log, "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("portal freshness never accepts legacy-only snapshots or exceeds approved RPO", () => {
  const now = new Date().toISOString();
  const env = { RCAT_POS_TOPOLOGY: "portal" };
  const legacy = [{ time: now, tags: ["rcat-pos-staging", "postgres16"] }];
  const portal = [{ time: now, tags: ["rcat-pos-staging", "rcat-pos-portal", "postgres16"] }];
  assert.notEqual(execute("python3", [snapshot], env, JSON.stringify(legacy)).status, 0);
  const ok = execute("python3", [snapshot], env, JSON.stringify(portal));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).maxAgeHours, 24);
  assert.notEqual(execute("python3", [snapshot], { ...env, RCAT_POS_BACKUP_MAX_AGE_HOURS: "25" }, JSON.stringify(portal)).status, 0);
});

test("opt-in maintenance container has DBA secret, runtime API does not", () => {
  const compose = readFileSync(root + "/compose.staging.yaml", "utf8");
  const api = compose.split("\n  api:")[1].split("\n  customer:")[0];
  const maintenance = compose.split("\n  budget_maintenance:")[1].split("\n  migrator:")[0];
  assert.match(maintenance, /profiles: \[ops\]/);
  assert.match(maintenance, /staging_pg_password/);
  assert.match(maintenance, /prune-guest-budgets --apply/);
  assert.doesNotMatch(api, /secrets:/);
  const dockerfile = readFileSync(root + "/Dockerfile.staging", "utf8");
  assert.match(dockerfile, /g4-retention-maintenance\.mjs/);
});


test("portal 049-052 read-only migration ledger plan rejects drift and preserves payment locks", () => {
  const planner = root + "/scripts/ops/portal-migration-plan.py";
  const help = execute("python3", [planner, "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Read-only Stage ledger report/);
  const missing = execute("python3", [planner]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /exact reviewed source SHA required/);

  // Unit-test only the pure validator: no Docker, real accounts, or database.
  const fixture = [
    "import runpy, sys",
    "m = runpy.run_path(sys.argv[1])",
    "inventory = m['inventory']",
    "assess = m['assess']",
    "Blocked = m['Blocked']",
    "protected_nonpayment = m['protected_nonpayment']",
    "from tempfile import TemporaryDirectory",
    "import os",
    "from pathlib import Path",
    "files = inventory(Path(sys.argv[2]))",
    "good = list(files.items())[:49]",
    "assert assess(files, good)['pending'] == list(files)[49:]",
    "assert assess(files, list(files.items()))['status'] == 'ALREADY_APPLIED'",
    "def denied(rows):",
    "    try: assess(files, rows)",
    "    except Blocked: return",
    "    raise AssertionError('unsafe ledger accepted')",
    "denied(good[:48])",
    "denied(good + [(list(files)[50], files[list(files)[50]])])",
    "denied(good[:-1] + [(good[-1][0], '0' * 64)])",
    "denied(good + [('999_unreviewed.sql', '1' * 64)])",
    "with TemporaryDirectory() as d:",
    "    file = Path(d) / '.env.portal'",
    "    base = '\\n'.join(key + '=false' for key in m['FLAGS'][:3]) + '\\n'",
    "    file.write_text(base)",
    "    os.chmod(file, 0o600)",
    "    protected_nonpayment(file)",
    "    file.write_text(base + 'ENABLE_DEVELOPMENT_AUTH=false\\n')",
    "    protected_nonpayment(file)",
    "    for unsafe in (base + 'ENABLE_DEVELOPMENT_AUTH=true\\n',",
    "                   base.replace('RCAT_POS_PAYMENT_QR_RELEASE_APPROVED=false\\n', ''),",
    "                   base + 'RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED=true\\n',",
    "                   base + 'RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED=false\\n'):",
    "        file.write_text(unsafe)",
    "        try: protected_nonpayment(file)",
    "        except Blocked: pass",
    "        else: raise AssertionError('unsafe environment admitted')",
    "    file.write_text(base)",
    "    os.chmod(file, 0o644)",
    "    try: protected_nonpayment(file)",
    "    except Blocked: pass",
    "    else: raise AssertionError('unsafe permissions admitted')",
    "print('PASS: pure ledger fail-closed tests')",
  ].join("\n");
  const result = execute("python3", ["-c", fixture, planner, root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS: pure ledger/);
  const source = readFileSync(planner, "utf8");
  assert.match(source, /BEGIN READ ONLY/);
  assert.match(source, /"exec", "-T", "postgres"/);
  assert.match(source, /"schemaMutation": "NONE"/);
  assert.match(source, /"paymentApproval": False/);
  assert.doesNotMatch(source, /compose\s+(?:up|run|build)|(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)/);
});
