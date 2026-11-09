#!/usr/bin/env node
// Read-only evidence gate: NEVER deploys, accepts policies or validates the truth of external proof.
// Operator must independently verify the referenced records; CI cannot certify an RCAT server.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const policyPath = fileURLToPath(new URL("../../docs/g4-staging-owner-policy.json", import.meta.url));
const stages = ["b1", "b2", "b3", "b4", "b5", "b6"];
const sha40 = /^[0-9a-f]{40}$/i;

function safeEvidenceLink(value) {
  if (typeof value !== "string" || value.length > 512 || /[?#@\s]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validatePolicy(policy) {
  if (policy?.schema_version !== 1 || policy?.scope !== "G4 non-payment RCAT on-prem staging only") {
    throw new Error("Invalid G4 policy schema/scope");
  }
  if (policy.stock?.approved !== true ||
      policy.stock.sold_out !== "manual_merchant_toggle" ||
      policy.stock.ingredient_consumption !== "on_merchant_acceptance" ||
      policy.stock.checkout_reservation !== false ||
      policy.stock.auto_sold_out !== false) {
    throw new Error("Approved G4 manual-stock invariants changed");
  }
  const slo = policy.slo;
  if (slo?.approved !== true || slo.guest_menu_p95_ms_max !== 2500 ||
      slo.order_submit_p95_ms_max !== 3000 || slo.backup_rpo_hours_max !== 24 ||
      slo.isolated_restore_rto_hours_max !== 4) {
    throw new Error("G4 owner-approved SLO thresholds do not match recorded decision");
  }
  if (policy.releases?.payment_authorized !== false || policy.releases?.production_authorized !== false) {
    throw new Error("G4 cannot authorize Payment or Production");
  }
  if (policy.backup?.auto_order_outbox_audit_deletion_approved !== false) {
    throw new Error("Order/Outbox/audit deletion is never approved by this G4 policy");
  }
  // Backup is deliberately pending. A future explicit owner decision must update
  // the associated Issue and this data file; a synthetic CI pass cannot approve it.
  return policy;
}

export function assessStaging(policy, evidence) {
  validatePolicy(policy);
  const blockers = [];
  const pendingBackup = policy.backup.policy_approved !== true ||
    policy.backup.offsite_destination_approved !== true ||
    policy.backup.cadence_approved !== true ||
    policy.backup.retention_approved !== true ||
    typeof policy.backup.offsite_destination !== "string" ||
    !policy.backup.offsite_destination.trim() ||
    typeof policy.backup.cadence !== "string" || !policy.backup.cadence.trim();
  if (pendingBackup) blockers.push("c2_offsite_cadence_retention_not_approved");
  if (policy.releases.g4_final_signoff !== true) blockers.push("g4_owner_final_signoff_missing");
  if (policy.releases.staging_deploy_approved !== true) blockers.push("staging_operator_deploy_approval_missing");

  if (!evidence) {
    blockers.push("real_host_evidence_missing");
  } else {
    if (evidence.schema_version !== 1 || evidence.environment !== "staging" ||
        evidence.production !== false || evidence.payment_enabled !== false ||
        !sha40.test(evidence.release_sha ?? "") ||
        typeof evidence.release_tag !== "string" ||
        !/^staging-[a-z0-9._-]{3,56}$/.test(evidence.release_tag) ||
        !Number.isFinite(Date.parse(evidence.observed_at ?? ""))) {
      blockers.push("invalid_real_staging_identity");
    }
    for (const stage of stages) {
      if (evidence[stage]?.status !== "verified" ||
          !safeEvidenceLink(evidence[stage]?.evidence_url) ||
          !Number.isFinite(Date.parse(evidence[stage]?.observed_at ?? ""))) {
        blockers.push(stage + "_independent_evidence_missing");
      }
    }
    const m = evidence.metrics ?? {};
    for (const [key, limit] of [
      ["guest_menu_p95_ms", policy.slo.guest_menu_p95_ms_max],
      ["order_submit_p95_ms", policy.slo.order_submit_p95_ms_max],
      ["backup_rpo_hours", policy.slo.backup_rpo_hours_max],
      ["isolated_restore_rto_hours", policy.slo.isolated_restore_rto_hours_max],
    ]) {
      if (typeof m[key] !== "number" || !Number.isFinite(m[key]) ||
          m[key] < 0 || m[key] > limit) blockers.push(key + "_missing_or_exceeds_target");
    }
    if (evidence.operator_signoff?.approved !== true ||
        !safeEvidenceLink(evidence.operator_signoff?.evidence_url)) {
      blockers.push("independent_operator_signoff_missing");
    }
    if (evidence.owner_signoff?.approved !== true ||
        !safeEvidenceLink(evidence.owner_signoff?.evidence_url)) {
      blockers.push("independent_owner_signoff_missing");
    }
  }
  return { status: blockers.length ? "blocked" : "candidate_for_manual_review", blockers };
}

function main(args) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write("Usage: node scripts/ops/g4-staging-acceptance.mjs --policy-only | --evidence /absolute/private/redacted-evidence.json\\n");
    return 0;
  }
  if (!(args.length === 1 && args[0] === "--policy-only") &&
      !(args.length === 2 && args[0] === "--evidence")) {
    throw new Error("Specify --policy-only or --evidence PATH");
  }
  const policy = validatePolicy(JSON.parse(readFileSync(policyPath, "utf8")));
  if (args[0] === "--policy-only") {
    const result = assessStaging(policy, null);
    process.stdout.write(JSON.stringify({
      c1_manual_stock: "approved",
      c3_guest_order_rpo_rto: "approved_targets_not_measured",
      c2_backup: "pending_offsite_and_cadence",
      g4_acceptance: result.status,
      blockers: result.blockers,
    }) + "\n");
    return 0; // policy correctness only: NOT a G4 success.
  }
  const evidence = JSON.parse(readFileSync(resolve(args[1]), "utf8"));
  const result = assessStaging(policy, evidence);
  // Do not print URL, hostnames, names, secrets, test data or raw JSON.
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.blockers.length ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch { process.stderr.write("G4 gate error: invalid/missing policy or evidence file (details redacted)\\n"); process.exitCode = 1; }
}
