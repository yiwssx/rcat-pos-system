#!/usr/bin/env node
// CI-only evidence/impact routing. It cannot authorize an operational deploy.
// A missing/invalid git base FAILS CLOSED by running all expensive checks.
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const WORKSPACE = [
  /^(?:apps|libs)\//,
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|nx\.json|angular\.json|tsconfig\.base\.json|\.node-version)$/,
  /^scripts\/smoke[^/]*\.(?:mjs|cjs|js)$/,
  /^tests\/pwa-service-worker\.mjs$/,
  /^\.github\/workflows\/workspace\.yml$/,
];
const IMAGE = [
  /^(?:compose\.(?:local|portal)\.yaml|\.env\.portal\.example)$/,
  /^infra\/local\//,
  /^scripts\/(?:dev\/local-seed\.mjs|ops\/local-demo\.sh)$/,
  /^tests\/ops\/local-demo/,
  /^(?:apps|libs)\//,
  /^(?:Dockerfile\.staging|compose\.staging\.yaml|\.dockerignore|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|nx\.json|angular\.json|tsconfig\.base\.json|\.node-version)$/,
  /^infra\/onprem\/nginx-static-api\.conf$/,
  /^scripts\/ops\/g4-retention-maintenance\.mjs$/,
  /^\.github\/workflows\/onprem-staging\.yml$/,
];
const OPS = [
  /^(?:compose\.(?:local|portal)\.yaml|\.env\.portal\.example)$/,
  /^infra\/local\//,
  /^(?:scripts\/ops|tests\/ops|scripts\/ci|tests\/ci)\//,
  /^(?:Dockerfile\.staging|compose\.staging\.yaml|\.dockerignore|\.env\.staging\.example)$/,
  /^infra\/onprem\//,
  /^\.github\/workflows\/(?:foundation|onprem-staging)\.yml$/,
];
const EXPLICIT_NONWORKSPACE = [
  /^docs\//, /^\.agents\//, /^\.github\//,
  /^tests\/(?:db|e2e|ops|ci)\//,
  /^scripts\/(?:db|ops|ci|load|dev)\//,
  /^db\//, /^infra\//, /^\.github\/ISSUE_TEMPLATE\//,
  /^(?:README\.md|AGENTS\.md|SECURITY\.md|CONTRIBUTING\.md|LICENSE|\.gitignore)$/,
  /^(?:Dockerfile\.staging|compose\.staging\.yaml|compose\.local\.yaml|compose\.portal\.yaml|\.env\.portal\.example|compose\.db\.yaml|\.dockerignore|\.env\.staging\.example)$/,
];
const isMatch = (rules, path) => rules.some((rule) => rule.test(path));

export function classify(paths, { uncertain = false } = {}) {
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string" || !p || p.startsWith("/") || p.includes(".."))) {
    throw new Error("Invalid change list");
  }
  const changed = [...new Set(paths)];
  // Unknown files are NOT an excuse to skip workspace verification.
  const unknown = changed.some((p) => !isMatch(EXPLICIT_NONWORKSPACE, p) && !isMatch(WORKSPACE, p));
  const safeDefault = uncertain || changed.length === 0;
  return {
    decision: safeDefault ? "fail_closed" : "scoped",
    changedCount: changed.length,
    workspace: safeDefault || unknown || changed.some((p) => isMatch(WORKSPACE, p)),
    onpremImages: safeDefault || changed.some((p) => isMatch(IMAGE, p)),
    onpremOps: safeDefault || changed.some((p) => isMatch(OPS, p)),
    criticalBoundaryChanged: safeDefault || changed.some((p) =>
      /^(?:db\/|apps\/api\/|libs\/server-auth\/|scripts\/db\/|tests\/db\/)/.test(p)),
    // These stay explicitly unverified even when CI succeeds.
    onpremHostVerified: false,
    externalOauthVerified: false,
    offsiteRestoreVerified: false,
    physicalDevicesVerified: false,
    productionApproved: false,
  };
}

function changedFiles(base, head) {
  const sha = /^[0-9a-f]{40}$/i;
  if (!sha.test(base ?? "") || !sha.test(head ?? "") || /^0{40}$/.test(base)) {
    return { paths: [], uncertain: true };
  }
  try {
    const stdout = execFileSync("git",
      ["diff", "--name-only", "--no-renames", "--diff-filter=ACMRTD", base, head],
      { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
    return { paths: stdout.trim() ? stdout.trim().split("\n") : [], uncertain: false };
  } catch {
    // Incomplete checkout, force-push or missing merge base: never green by skipping.
    return { paths: [], uncertain: true };
  }
}

// Historical CI success is scoped to its tested source; each new commit
// invalidates only claims whose guarded inputs have changed since the merge.
export function evaluateHistoricalEvidence(register, diffForCommit) {
  if (register?.schema_version !== 1 || !Array.isArray(register.claims)) {
    throw new Error("Evidence register schema invalid");
  }
  return register.claims.map((claim) => {
    if (claim.status !== "verified_ci") {
      return { id: claim.id, state: "pending_external_or_owner" };
    }
    if (!/^[0-9a-f]{40}$/i.test(claim.merge_sha ?? "") ||
        !Array.isArray(claim.invalidated_by) ||
        claim.invalidated_by.length === 0) {
      return { id: claim.id, state: "requires_new_ci" };
    }
    const difference = diffForCommit(claim.merge_sha);
    if (difference.uncertain || difference.paths.some((path) =>
      claim.invalidated_by.some((match) => path === match ||
        (match.endsWith("/") && path.startsWith(match)) ||
        (match.endsWith("-") && path.startsWith(match))))) {
      return { id: claim.id, state: "requires_new_ci" };
    }
    return { id: claim.id, state: "reusable_ci_scope_only" };
  });
}

export function formatSummary(result, evidenceStates = []) {
  return [
    "### RCAT POS Lean CI impact",
    "",
    "| Gate | Decision |",
    "| --- | --- |",
    "| Scope | " + result.decision + " (" + result.changedCount + " changed paths) |",
    "| Nx Workspace build/typecheck/test | " + (result.workspace ? "RUN" : "SKIP — unrelated") + " |",
    "| On-prem Docker image build | " + (result.onpremImages ? "RUN" : "SKIP — no image inputs changed") + " |",
    "| Operations safety tests | " + (result.onpremOps ? "RUN" : "SKIP — unrelated") + " |",
    "| Security-sensitive source changed | " + (result.criticalBoundaryChanged ? "YES — keep specialized SQL/HTTP gates" : "NO") + " |",
    "",
    "Historical evidence: " + evidenceStates.map((entry) => entry.id + "=" + entry.state).join("; "),
    "",
    "A green/skipped CI job **does not** approve On-prem Staging, external OAuth, real restore, physical devices, Payment or Production.",
    "",
  ].join("\n");
}

async function main() {
  const [base, head] = process.argv.slice(2);
  const diff = changedFiles(base, head);
  const result = classify(diff.paths, { uncertain: diff.uncertain });
  let evidenceStates;
  try {
    const register = JSON.parse(readFileSync(new URL("../../docs/evidence-register.json", import.meta.url), "utf8"));
    evidenceStates = evaluateHistoricalEvidence(register,
      (mergeSha) => changedFiles(mergeSha, head));
  } catch {
    // Missing/malformed ledger is not a reason to reuse prior evidence.
    evidenceStates = [{ id: "ALL", state: "requires_new_ci" }];
  }
  result.historicalEvidence = evidenceStates;
  process.stdout.write(JSON.stringify(result) + "\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      "workspace=" + result.workspace,
      "onprem_images=" + result.onpremImages,
      "onprem_ops=" + result.onpremOps,
      "critical=" + result.criticalBoundaryChanged,
      "decision=" + result.decision,
    ].join("\n") + "\n");
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatSummary(result, evidenceStates));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
