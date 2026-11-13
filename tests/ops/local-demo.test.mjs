import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rcat-local-"));
  const bin = join(dir, "bin");
  mkdirSync(bin); mkdirSync(join(dir, "scripts/ops"), { recursive: true });
  const script = join(dir, "scripts/ops/local-demo.sh");
  copyFileSync(new URL("../../scripts/ops/local-demo.sh", import.meta.url), script);
  const mock = (name, content) => writeFileSync(join(bin, name), "#!/bin/bash\nset -eu\n" + content, { mode: 0o755 });
  mock("docker", `
[[ -z "\u0024{DOCKER_HOST:-}" && -z "\u0024{DOCKER_CONTEXT:-}" ]] || exit 91
echo "$*" >> "$MOCK_LOG"
[[ "$*" != *"volume inspect"* ]] || exit "\u0024{MOCK_VOLUME_STATUS:-1}"
exit 0
`);
  mock("git", "echo 0123456789ab\n");
  mock("ss", 'if [[ "${MOCK_BUSY:-no}" == yes ]]; then echo LISTEN; fi\n');
  const run = (command = "up", extra = {}) => spawnSync("bash", [script, command], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, PATH: bin + ":" + process.env.PATH, MOCK_LOG: join(dir, "calls"), ...extra },
  });
  return { dir, run, env: join(dir, ".env.local"), state: join(dir, ".secrets/local-demo"),
    log: () => readFileSync(join(dir, "calls"), "utf8"),
    clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test("first start generates private files, keeps credentials on repeat, and uses only the local daemon/project", () => {
  const x = fixture();
  try {
    let result = x.run("up", { DOCKER_HOST: "tcp://unrelated:2376", DOCKER_CONTEXT: "other" });
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(x.env, "utf8");
    const password = readFileSync(join(x.state, "owner-password"), "utf8").trim();
    assert.match(result.stdout, /LOCAL_DEMO_READY/);
    assert.ok(!(result.stdout + result.stderr).includes(password));
    result = x.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(x.env, "utf8"), env);
    assert.equal(readFileSync(join(x.state, "owner-password"), "utf8").trim(), password);
    assert.match(x.log(), /-p rcat-pos-local -f .*compose\.local\.yaml/);
    assert.match(x.log(), /run --rm --no-deps migrator/);
    assert.match(x.log(), /run --rm --no-deps seed/);
    assert.doesNotMatch(x.log(), /compose\.staging|down|prune/);
    assert.ok(!x.log().includes(password));
    const credentials = x.run("credentials");
    assert.equal(credentials.status, 0, credentials.stderr);
    assert.ok(credentials.stdout.includes(password));
    assert.equal(x.run("stop").status, 0);
    assert.equal(readFileSync(join(x.state, "owner-password"), "utf8").trim(), password);
  } finally { x.clean(); }
});

test("missing configuration with an existing database refuses to replace credentials", () => {
  const x = fixture();
  try {
    const result = x.run("up", { MOCK_VOLUME_STATUS: "0" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Existing demo database/);
    assert.doesNotMatch(x.log(), /build|run --rm|up -d/);
  } finally { x.clean(); }
});

test("occupied local ports fail before any build or container changes", () => {
  const x = fixture();
  try {
    const result = x.run("up", { MOCK_BUSY: "yes" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Port 11880 is occupied/);
    assert.doesNotMatch(x.log(), /build|run --rm|up -d/);
  } finally { x.clean(); }
});

test("unsafe permissions, symlinks and mismatched runtime passwords fail before mutation", () => {
  const x = fixture();
  try {
    assert.equal(x.run().status, 0);
    chmodSync(x.env, 0o644);
    assert.match(x.run().stderr, /mode 600/);
    chmodSync(x.env, 0o600);
    const original = readFileSync(x.env, "utf8");
    writeFileSync(x.env, original.replace(/RCAT_LOCAL_AUTH_PASSWORD=.+/, "RCAT_LOCAL_AUTH_PASSWORD=" + "0".repeat(64)));
    assert.match(x.run().stderr, /differs from its secret/);
    writeFileSync(x.env, original);
    rmSync(join(x.state, "owner-password"));
    symlinkSync(join(x.state, "auth-password"), join(x.state, "owner-password"));
    assert.match(x.run().stderr, /unsafe local file/);
    assert.notEqual(x.run("reset").status, 0);
  } finally { x.clean(); }
});

test("Docker Compose accepts the Local manifest and publishes only fixed loopback web ports", (t) => {
  const cli = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (cli.error?.code === "ENOENT") { t.skip("Compose CLI absent; real Compose/browser verification runs in packaging CI"); return; }
  assert.equal(cli.status, 0, cli.stderr);
  const result = spawnSync("docker", ["compose", "--profile", "setup", "-f", "compose.local.yaml", "config", "--format", "json"], {
    encoding: "utf8", env: { ...process.env, RCAT_LOCAL_RELEASE: "local-ci", RCAT_LOCAL_AUTH_PASSWORD: "a".repeat(64), RCAT_LOCAL_TENANT_PASSWORD: "b".repeat(64), RCAT_LOCAL_PEPPER: "c".repeat(64) },
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.name, "rcat-pos-local");
  for (const name of ["api", "postgres"]) assert.equal(config.services[name].ports, undefined);
  for (const [index, name] of ["customer"].entries()) {
    assert.equal(config.services[name].ports[0].host_ip, "127.0.0.1");
    assert.equal(config.services[name].ports[0].published, String(11880 + index));
  }
  assert.equal(config.services.merchant, undefined);
  assert.equal(config.services.admin, undefined);
  assert.equal(config.services.api.environment.AUTH_ALLOWED_ORIGINS, "https://localhost:11880");
  assert.equal(config.services.api.environment.NODE_ENV, "development");
  assert.equal(config.services.api.secrets, undefined);
  assert.equal(config.services.seed.profiles[0], "setup");
});
