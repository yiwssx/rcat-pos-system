import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify, formatSummary, evaluateHistoricalEvidence } from "../../scripts/ci/impact-policy.mjs";

const root = new URL("../../", import.meta.url);
const load = () => JSON.parse(readFileSync(new URL("docs/evidence-register.json", root), "utf8"));

test("docs-only change reuses existing CI rather than installing Nx or rebuilding Docker", () => {
  const result = classify(["docs/LEAN-EVIDENCE-DELIVERY.md", "docs/evidence-register.json"]);
  assert.equal(result.workspace, false);
  assert.equal(result.onpremImages, false);
  assert.equal(result.onpremOps, false);
  assert.equal(result.criticalBoundaryChanged, false);
  assert.equal(result.onpremHostVerified, false);
});

test("operator-only maintenance change runs safety checks, not Nx or images", () => {
  const result = classify(["scripts/ops/onprem-operations.sh", "tests/ops/onprem-operations.test.mjs"]);
  assert.equal(result.workspace, false);
  assert.equal(result.onpremImages, false);
  assert.equal(result.onpremOps, true);
});

test("Local demo inputs select Compose/browser verification without repeating unchanged Nx", () => {
  for (const path of ["compose.local.yaml", "infra/local/start.html", "infra/local/nginx.conf",
    "scripts/dev/local-seed.mjs", "scripts/ops/local-demo.sh", "tests/ops/local-demo-browser.cjs"]) {
    const result = classify([path]);
    assert.equal(result.onpremImages, true, path);
    assert.equal(result.workspace, false, path);
  }
});

test("Dockerfile, Angular and DB changes select only relevant gates", () => {
  assert.equal(classify(["Dockerfile.staging"]).onpremImages, true);
  assert.equal(classify(["Dockerfile.staging"]).workspace, false);
  const angular = classify(["apps/merchant/src/app/order.page.ts"]);
  assert.equal(angular.workspace, true);
  assert.equal(angular.onpremImages, true);
  const sql = classify(["db/migrations/034_safe_fix.sql"]);
  assert.equal(sql.workspace, false);
  assert.equal(sql.criticalBoundaryChanged, true);
  const auth = classify(["apps/api/src/auth/google-workspace-auth.service.ts"]);
  assert.equal(auth.criticalBoundaryChanged, true);
  assert.equal(auth.workspace, true);
});

test("unknown paths, empty diff and corrupt base fail safe and never prove server readiness", () => {
  const unknown = classify(["new-security-configuration.any"]);
  assert.equal(unknown.workspace, true);
  assert.equal(unknown.onpremHostVerified, false);
  const empty = classify([]);
  assert.equal(empty.decision, "fail_closed");
  assert.equal(empty.workspace, true);
  assert.equal(empty.onpremImages, true);
  const uncertain = classify(["README.md"], { uncertain: true });
  assert.equal(uncertain.workspace, true);
  assert.equal(uncertain.criticalBoundaryChanged, true);
  assert.match(formatSummary(uncertain), /does not.*approve On-prem Staging/i);
  assert.throws(() => classify(["../unsafe"]), /Invalid change/);
});

test("evidence register is complete, immutable-commit-linked and never marks host accepted", () => {
  const register = load();
  assert.equal(register.schema_version, 1);
  assert.equal(register.repository, "yiwssx/rcat-pos-system");
  assert.ok(Array.isArray(register.claims));
  const ids = new Set();
  for (const entry of register.claims) {
    assert.match(entry.id, /^[A-Z0-9-]+$/);
    assert.ok(!ids.has(entry.id), "Repeated evidence criterion");
    ids.add(entry.id);
    assert.ok(Number.isInteger(entry.issue) && entry.issue > 0);
    assert.ok(Array.isArray(entry.covers));
    assert.ok(Array.isArray(entry.excludes) && entry.excludes.length > 0);
    if (entry.status === "verified_ci") {
      assert.equal(entry.scope, "ci");
      assert.ok([83, 84, 85].includes(entry.pr));
      assert.match(entry.head_sha, /^[0-9a-f]{40}$/);
      assert.match(entry.merge_sha, /^[0-9a-f]{40}$/);
      assert.ok(Number.isInteger(entry.run_id) && entry.run_id > 0);
      assert.ok(entry.workflow.length > 8);
      assert.ok(entry.covers.length > 0);
      assert.ok(Array.isArray(entry.supporting_runs));
      for (const run of entry.supporting_runs) {
        assert.ok(Number.isInteger(run.run_id) && run.run_id > 0);
        assert.ok(run.workflow.length > 8);
      }
    } else {
      assert.ok(["pending_external", "pending_owner", "not_started"].includes(entry.status));
      assert.ok(entry.scope !== "ci");
      assert.equal(entry.covers.length, 0);
      assert.equal(Object.hasOwn(entry, "run_id"), false);
    }
  }
  assert.ok(ids.has("G4-B-REAL-STAGING"));
  assert.ok(ids.has("G4-C-OWNER-POLICY"));
  assert.ok(ids.has("G5-G6-PAYMENT-RELEASE"));
});


test("historical CI evidence is reused only when no guarded inputs changed since its merge", () => {
  const register = load();
  const unchanged = evaluateHistoricalEvidence(register, () => ({ paths: ["docs/notes.md"], uncertain: false }));
  assert.equal(unchanged.find((x) => x.id === "G4-A1-PACKAGING").state, "reusable_ci_scope_only");
  assert.equal(unchanged.find((x) => x.id === "G4-B-REAL-STAGING").state, "pending_external_or_owner");
  const change = evaluateHistoricalEvidence(register, (mergeSha) => {
    if (mergeSha === register.claims[0].merge_sha) {
      return { paths: ["Dockerfile.staging"], uncertain: false };
    }
    return { paths: ["docs/notes.md"], uncertain: false };
  });
  assert.equal(change.find((x) => x.id === "G4-A1-PACKAGING").state, "requires_new_ci");
  assert.equal(change.find((x) => x.id === "G4-A2-A3-OPS").state, "reusable_ci_scope_only");
  assert.equal(evaluateHistoricalEvidence(register, () => ({ paths: [], uncertain: true }))[0].state, "requires_new_ci");
});
