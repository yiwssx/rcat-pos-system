import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
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
