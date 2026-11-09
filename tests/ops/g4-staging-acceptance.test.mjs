import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessStaging, validatePolicy } from "../../scripts/ops/g4-staging-acceptance.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const policy = JSON.parse(readFileSync(join(root, "docs/g4-staging-owner-policy.json"), "utf8"));
const script = join(root, "scripts/ops/g4-staging-acceptance.mjs");
const clone = (input) => structuredClone(input);

function fakeEvidence() {
  const link = "https://github.com/yiwssx/rcat-pos-system/issues/81";
  const item = () => ({ status: "verified", evidence_url: link, observed_at: "2026-11-09T07:00:00Z" });
  return {
    schema_version: 1,
    environment: "staging",
    production: false,
    payment_enabled: false,
    release_tag: "staging-commit-abc1234",
    release_sha: "a".repeat(40),
    observed_at: "2026-11-09T07:00:00Z",
    b1: item(), b2: item(), b3: item(), b4: item(), b5: item(), b6: item(),
    metrics: { guest_menu_p95_ms: 2000, order_submit_p95_ms: 2400,
      backup_rpo_hours: 10, isolated_restore_rto_hours: 2 },
    operator_signoff: { approved: true, evidence_url: link },
    owner_signoff: { approved: true, evidence_url: link },
  };
}

test("recorded owner decision is exact, stock stays on accept and deferred backup stays off", () => {
  assert.doesNotThrow(() => validatePolicy(policy));
  assert.equal(policy.stock.sold_out, "manual_merchant_toggle");
  assert.equal(policy.stock.ingredient_consumption, "on_merchant_acceptance");
  assert.equal(policy.backup.policy_approved, false);
  assert.equal(policy.backup.guest_budget_prune_approved, false);
  assert.equal(policy.releases.production_authorized, false);
  assert.equal(policy.releases.payment_authorized, false);
  const bad = clone(policy);
  bad.stock.checkout_reservation = true;
  assert.throws(() => validatePolicy(bad), /stock/);
  bad.stock.checkout_reservation = false;
  bad.releases.payment_authorized = true;
  assert.throws(() => validatePolicy(bad), /Payment/);
});

test("empty and synthetic green host reports cannot bypass pending C2 or owner signoff", () => {
  const empty = assessStaging(policy, null);
  assert.equal(empty.status, "blocked");
  assert.ok(empty.blockers.includes("c2_offsite_cadence_retention_not_approved"));
  assert.ok(empty.blockers.includes("real_host_evidence_missing"));
  const claimed = assessStaging(policy, fakeEvidence());
  assert.equal(claimed.status, "blocked");
  assert.ok(claimed.blockers.includes("c2_offsite_cadence_retention_not_approved"));
  assert.ok(claimed.blockers.includes("g4_owner_final_signoff_missing"));
});

test("independent stage or numeric SLO failures are blocked even after synthetic policy approval", () => {
  const hypotheticallyApproved = clone(policy);
  hypotheticallyApproved.backup.policy_approved = true;
  hypotheticallyApproved.backup.offsite_destination_approved = true;
  hypotheticallyApproved.backup.cadence_approved = true;
  hypotheticallyApproved.backup.retention_approved = true;
  hypotheticallyApproved.backup.offsite_destination = "approved-offsite";
  hypotheticallyApproved.backup.cadence = "approved-schedule";
  hypotheticallyApproved.releases.staging_deploy_approved = true;
  hypotheticallyApproved.releases.g4_final_signoff = true;
  assert.equal(assessStaging(hypotheticallyApproved, fakeEvidence()).status, "candidate_for_manual_review");
  const bad = fakeEvidence();
  bad.b2.evidence_url = "https://example.org/path?token=sensitive";
  bad.metrics.order_submit_p95_ms = 3001;
  bad.metrics.backup_rpo_hours = -1;
  bad.production = true;
  const report = assessStaging(hypotheticallyApproved, bad);
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("b2_independent_evidence_missing"));
  assert.ok(report.blockers.includes("order_submit_p95_ms_missing_or_exceeds_target"));
  assert.ok(report.blockers.includes("backup_rpo_hours_missing_or_exceeds_target"));
  assert.ok(report.blockers.includes("invalid_real_staging_identity"));
});

test("CLI policy-only validates without claiming acceptance, redacts input and does not deploy", () => {
  const p = spawnSync(process.execPath, [script, "--policy-only"], { encoding: "utf8", timeout: 10000 });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(JSON.parse(p.stdout).g4_acceptance, "blocked");
  const dir = mkdtempSync(join(tmpdir(), "rcat-g4-gate-"));
  try {
    const input = join(dir, "private.json");
    const body = fakeEvidence();
    body.operator_signoff.evidence_url = "https://example.org/ops-secret?token=must-not-leak";
    writeFileSync(input, JSON.stringify(body), { mode: 0o600 });
    const x = spawnSync(process.execPath, [script, "--evidence", input], { encoding: "utf8", timeout: 10000 });
    assert.equal(x.status, 2, x.stderr);
    assert.equal(JSON.parse(x.stdout).status, "blocked");
    assert.doesNotMatch(x.stdout + x.stderr, /must-not-leak|ops-secret|private.json/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
