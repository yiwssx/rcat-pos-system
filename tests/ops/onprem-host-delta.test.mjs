import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const script = join(root, "scripts/ops/onprem-host-delta.sh");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rcat-host-delta-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const fake = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, "#!/bin/sh\n" + body + "\n", { mode: 0o700 });
    chmodSync(path, 0o700);
  };
  fake("ss", 'if [ -n "${MOCK_LISTEN_PORT:-}" ]; then printf "LISTEN 0 4096 0.0.0.0:%s 0.0.0.0:*\\n" "$MOCK_LISTEN_PORT"; fi');
  fake("ip", 'if [ "${MOCK_LAN_ABSENT:-}" != yes ]; then echo "2: enp3s0 inet 10.10.1.100/24 brd 10.10.1.255 scope global enp3s0"; fi');
  fake("docker", 'if [ "${MOCK_EXISTING_PROJECT:-}" = yes ]; then echo synthetic-existing-container; fi');
  const secret = join(dir, "pg-password");
  const envFile = join(dir, ".env.staging");
  writeFileSync(secret, "private-synthetic-test-only\n", { mode: 0o600 });
  const vars = {
    RCAT_POS_ENVIRONMENT: "staging",
    RCAT_POS_RELEASE: "staging-host-delta-ci",
    RCAT_POS_HOST_BIND_IP: "127.0.0.1",
    RCAT_POS_CUSTOMER_PORT: "11880",
    RCAT_POS_MERCHANT_PORT: "11881",
    RCAT_POS_ADMIN_PORT: "11882",
    RCAT_POS_DB_PASSWORD_FILE: secret,
    AUTH_DATABASE_URL: "postgresql://test_auth:x@postgres:5432/rcat_pos_staging",
    TENANT_DATABASE_URL: "postgresql://test_tenant:y@postgres:5432/rcat_pos_staging",
    AUTH_ALLOWED_ORIGINS: "https://merchant-staging.example.invalid",
    CORS_ORIGINS: "https://customer-staging.example.invalid,https://merchant-staging.example.invalid",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://merchant-staging.example.invalid/api/auth/google/callback",
    GUEST_TABLE_CODE_PEPPER: "a".repeat(64),
    GUEST_ORDER_BASE_URL: "https://customer-staging.example.invalid/order",
  };
  const save = () => writeFileSync(envFile, Object.entries(vars).map(([k, v]) => k + "=" + v).join("\n") + "\n", { mode: 0o600 });
  save();
  const run = (extra = {}, args = []) => spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PATH: bin + ":" + process.env.PATH, RCAT_POS_ENV_FILE: envFile, ...extra },
  });
  return { dir, vars, save, run };
}

test("B1 host delta is read-only and never claims staging/owner acceptance", () => {
  const x = fixture();
  try {
    const result = x.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /port_collision=none compose_project=absent/);
    assert.match(result.stdout, /PENDING: capacity sizing, RMS HTTPS/);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-client-secret|private-synthetic-test-only/);
    assert.notEqual(x.run({}, ["--apply"]).status, 0, "no mutating argument allowed");
  } finally {
    rmSync(x.dir, { recursive: true, force: true });
  }
});

test("B1 host delta fails closed on busy ports or an existing Compose project", () => {
  const x = fixture();
  try {
    const busy = x.run({ MOCK_LISTEN_PORT: "11881" });
    assert.notEqual(busy.status, 0);
    assert.match(busy.stderr, /port 11881 already listens/);
    const existing = x.run({ MOCK_EXISTING_PROJECT: "yes" });
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /Compose project already exists/);
  } finally {
    rmSync(x.dir, { recursive: true, force: true });
  }
});

test("B1 host delta requires assigned LAN address and protected staging inputs", () => {
  const x = fixture();
  try {
    x.vars.RCAT_POS_HOST_BIND_IP = "10.10.1.100";
    x.save();
    assert.equal(x.run().status, 0);
    const absent = x.run({ MOCK_LAN_ABSENT: "yes" });
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /not assigned/);
    x.vars.RCAT_POS_ENVIRONMENT = "production";
    x.save();
    const unsafe = x.run();
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /configuration preflight failed/);
  } finally {
    rmSync(x.dir, { recursive: true, force: true });
  }
});
