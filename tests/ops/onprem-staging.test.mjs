import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const script = join(root, "scripts/ops/onprem-staging.sh");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rcat-onprem-"));
  const secret = join(dir, "pg-password");
  const envFile = join(dir, ".env.staging");
  writeFileSync(secret, "synthetic-test-only\n", { mode: 0o600 });
  const vars = {
    RCAT_POS_ENVIRONMENT: "staging",
    RCAT_POS_RELEASE: "staging-ci-synthetic",
    RCAT_POS_HOST_BIND_IP: "127.0.0.1",
    RCAT_POS_CUSTOMER_PORT: "11880",
    RCAT_POS_MERCHANT_PORT: "11881",
    RCAT_POS_ADMIN_PORT: "11882",
    RCAT_POS_DB_PASSWORD_FILE: secret,
    AUTH_DATABASE_URL: "postgresql://synthetic_auth:x@postgres:5432/rcat_pos_staging",
    TENANT_DATABASE_URL: "postgresql://synthetic_tenant:y@postgres:5432/rcat_pos_staging",
    AUTH_ALLOWED_ORIGINS: "https://merchant-staging.example.invalid",
    CORS_ORIGINS: "https://merchant-staging.example.invalid",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://merchant-staging.example.invalid/api/auth/google/callback",
    GUEST_TABLE_CODE_PEPPER: "a".repeat(64),
    GUEST_ORDER_BASE_URL: "https://customer-staging.example.invalid/order",
  };
  const save = () => {
    writeFileSync(
      envFile,
      Object.entries(vars).map(([key, value]) => key + "=" + value).join("\n") + "\n",
      { mode: 0o600 },
    );
    chmodSync(envFile, 0o600);
  };
  save();
  const run = (...args) => spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, RCAT_POS_ENV_FILE: envFile },
    timeout: 15_000,
  });
  return { dir, envFile, secret, vars, save, run };
}

test("staging preflight accepts only explicit safe staging inputs and never emits credentials", () => {
  const x = fixture();
  try {
    const result = x.run("preflight");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS: safe staging/);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-client-secret|synthetic-test-only/);
    assert.equal(x.run("build").status, 1);
    assert.match(x.run("deploy").stderr, /--apply/);
    assert.match(x.run("migrate").stderr, /--apply/);
    assert.match(x.run("rollback").stderr, /--apply/);
  } finally {
    rmSync(x.dir, { recursive: true, force: true });
  }
});

test("staging preflight rejects public interface, unsafe names, duplicates and test login", () => {
  const x = fixture();
  try {
    for (const [field, value] of [
      ["RCAT_POS_ENVIRONMENT", "production"],
      ["RCAT_POS_HOST_BIND_IP", "0.0.0.0"],
      ["RCAT_POS_RELEASE", "latest"],
      ["RCAT_POS_CUSTOMER_PORT", "11881"],
      ["ENABLE_DEVELOPMENT_AUTH", "true"],
      ["GUEST_TABLE_CODE_PEPPER", "unsafe"],
      ["GOOGLE_OAUTH_REDIRECT_URI", "http://unsafe.test/callback"],
      ["AUTH_DATABASE_URL", x.vars.TENANT_DATABASE_URL],
      ["AUTH_ALLOWED_ORIGINS", "*"],
    ]) {
      const previous = x.vars[field];
      x.vars[field] = value;
      x.save();
      const result = x.run("preflight");
      assert.notEqual(result.status, 0, field + " should be denied");
      assert.match(result.stderr, /PREFLIGHT FAILED/);
      if (previous === undefined) delete x.vars[field];
      else x.vars[field] = previous;
    }
    x.save();
    chmodSync(x.envFile, 0o644);
    assert.match(x.run("preflight").stderr, /chmod 600/);
    chmodSync(x.envFile, 0o600);
    chmodSync(x.secret, 0o644);
    assert.match(x.run("preflight").stderr, /mode 600/);
  } finally {
    rmSync(x.dir, { recursive: true, force: true });
  }
});

test("checked-in staging Compose never publishes API or PostgreSQL, and only migrates on opt-in", () => {
  const compose = readFileSync(join(root, "compose.staging.yaml"), "utf8");
  assert.match(compose, /name: rcat-pos-staging/);
  assert.match(compose, /database_private:[\s\S]*internal: true/);
  assert.match(compose, /migrator:[\s\S]*profiles: \[ops\]/);
  assert.match(compose, /NODE_ENV: production/);
  assert.match(compose, /ENABLE_DEVELOPMENT_AUTH: "false"/);
  assert.match(compose, /POSTGRES_PASSWORD_FILE: \/run\/secrets\/staging_pg_password/);
  assert.match(compose, /RCAT_API_BIND_HOST: "0\.0\.0\.0"/);
  assert.match(compose, /RCAT_POS_HOST_BIND_IP/);
  const postgres = compose.split("\n  postgres:")[1]?.split("\n  api:")[0] ?? "";
  const api = compose.split("\n  api:")[1]?.split("\n  customer:")[0] ?? "";
  assert.doesNotMatch(postgres, /^    ports:/m);
  assert.doesNotMatch(api, /^    ports:/m);
  const nginx = readFileSync(join(root, "infra/onprem/nginx-static-api.conf"), "utf8");
  assert.match(nginx, /proxy_buffering off;/);
  assert.match(nginx, /proxy_read_timeout 60s;/);
  assert.match(nginx, /access_log off;/);
  assert.match(nginx, /location = \/sw\.js/);
  const dockerignore = readFileSync(join(root, ".dockerignore"), "utf8");
  assert.match(dockerignore, /^\.secrets$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
});

test("docker compose parser validates synthetic staging configuration (no daemon required)", (t) => {
  const cli = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (cli.error?.code === "ENOENT") {
    t.skip("Docker Compose CLI not installed on this runner");
    return;
  }
  assert.equal(cli.status, 0, cli.stderr);
  const x = fixture();
  try {
    const config = spawnSync(
      "docker",
      ["compose", "--project-directory", root, "--env-file", x.envFile, "-f", join(root, "compose.staging.yaml"), "config", "--quiet"],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(config.status, 0, config.stderr);
    assert.doesNotMatch(config.stdout + config.stderr, /synthetic-client-secret/);
  } finally {
    rmSync(x.dir, { recursive: true, force: true });
  }
});
