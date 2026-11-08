# RCAT POS — Lean Evidence-Based Delivery (G4 On-prem Staging)

**Adopted 9 November 2026.** This policy replaces repeated "run everything" habits with **provenance-aware, scoped verification**. Existing G4 A coding [#80](https://github.com/yiwssx/rcat-pos-system/issues/80) is closed; real RCAT IOT Staging [#81](https://github.com/yiwssx/rcat-pos-system/issues/81) and owner decisions [#82](https://github.com/yiwssx/rcat-pos-system/issues/82) are **not** verified. No Payment/PromptPay until G5 [#7](https://github.com/yiwssx/rcat-pos-system/issues/7). Never infer actual server approval from CI.

## Rules of evidence

1. Each assertion has a **specific scope and provenance**: PR head SHA (source tested), merged SHA (baseline), GitHub Actions workflow/run and excluded environments in [evidence-register.json](./evidence-register.json).
2. `verified_ci` is historical proof of the **tested source in ephemeral CI**, **not a claim that the current SHA or any RCAT host is accepted**. `scripts/ci/impact-policy.mjs` calculates changes relative to each claim's merged SHA: a matching guarded input requires **new CI evidence**. A failure to diff is *fail-closed*.
3. GitHub Workflow gating is by changed file, **not just a successful result**: a job may be green because its expensive steps were correctly *not applicable*. The Actions run summary identifies the decision. Do **not** report a skipped Docker build as a new image qualification.
4. Critical DB/RLS/auth/Order/stock, recovery, Browser HTTP and Nx checks continue on relevant changes; they are **not** removed merely because a prior PR was green. New or unclassified paths conservatively trigger Nx.
5. The human owner's policies (stock/retention/RPO/RTO/SLO), external provider reachability, live HTTPS, physical devices and *actual restore* cannot be accepted by synthetic CI. Do not auto-approve, use credentials, or mark B/C/Production done.

## CI: what now runs, and why

| Change category | Tests to run | Avoid duplicate work |
| --- | --- | --- |
| Docs, issue trackers, policies only | Lightweight Foundation metadata/evidence validation | Do not install pnpm, build Angular or Docker images |
| `scripts/ops/onprem-*`, operator timers, ops tests | Foundation bounded safety tests | Do not run Nx, rebuild all images or database restore CI |
| Angular/NestJS/shared libraries | Nx affected build/typecheck/test/lint/smoke; relevant PostgreSQL/HTTP E2E; On-prem image packaging | Each workflow tests a **different invariant**, not a second local CI |
| `Dockerfile.staging`, static Nginx, staging Compose | Container build/inspection, operator safeguards | No Nx compilation on a second runner purely for Docker metadata |
| `db/**`, `scripts/db/**` | PostgreSQL tenant/RLS, recovery and relevant Browser E2E | No unrelated on-prem or UI-only tests by default |
| `scripts/ops/ci-backup-restore.sh` | Isolated PostgreSQL restore | Not triggered by generic host backup/monitoring scripts |
| Unknown files, inaccessible Git base | Fail-closed full relevant checks | No silent skipped required verification |

CI runs with GitHub-hosted runners and repository-pinned Node 24/pnpm 10. This policy does **not** add a Python-version matrix. The existing Restic snapshot metadata helper uses the runner's single available `python3`; multiple Python installations provide no added value to this file.

`Workspace quality` preserves one stable status check: it uses `Nx affected` on both Pull Requests **and main pushes**, and falls back to full Workspace verification if the base commit is unavailable. `Foundation checks` retains a stable, cheap evidence gate. `On-prem staging container packaging` skips expensive image builds when only operator scripts/tests changed; its step summary makes this explicit. **If your branch ruleset requires these checks, keep the check names stable**; skipped tasks must not be mistaken for tests that ran.

## B1 minimal RCAT IOT Server preflight (run once per deployment change)

**Reuse** established evidence for Ubuntu, Docker/Compose availability, existing PDF HUB/AnyFlip/Radio workloads, networking and source CI **only if the evidence is from the same unchanged host/configuration**. Do not collect a 10-item full host inventory again simply to fill a checklist.

Check only volatile facts that can invalidate deployment:

- [ ] The planned three RCAT POS published ports are **not already occupied**, and the intended Docker project/volume names do not collide. Verify from current host state rather than an old CI result.
- [ ] Free RAM/storage and database volume headroom are sufficient at the **time of deployment**, considering other containers (no arbitrary requirement to collect old CPU logs).
- [ ] Proposed RMS→IOT ingress is HTTPS with the intended three origins, no public NestJS/PostgreSQL bypass and appropriate forwarding/firewall. This is a **new POS route**; old AnyFlip/PDF success does not prove it.
- [ ] Staging-only protected secrets, distinct database restricted roles and migrations are correctly configured. Existing `onprem-staging.sh preflight` and `config` validate configuration, not human business policy.
- [ ] B owner has approved staging operation and C owner has approved any necessary mutable retention/scheduler policy. Any missing dependency is **blocked**, not an excuse to run more tests.

Do not run `local-ci`, `pnpm build`, `pnpm test`, PostgreSQL RLS fixtures, browser E2E suites or CI migrations again on the RCAT host. CI synthetic database test fixtures MUST NOT be run on Staging data. These are not Server Acceptance gates.

## Post-deploy: bounded **new-environment** evidence only

When B authorizes deployment, run:
1. **One** `onprem-staging.sh verify` / `onprem-operations.sh readiness` to confirm the three origins and true `/api/ready` PostgreSQL dependency (do not use `/api/health` alone).
2. **One** real HTTPS Google Workspace `@rcat.ac.th` login/CSRF session and one synthetic guest QR → Order `not_requested` → Merchant acceptance flow; verify streaming/replay only for newly introduced RMS/On-prem routing. Do not inspect real users' tokens or publish test QR grants.
3. **One** isolated encrypted offsite-backup restore with integrity/RPO/RTO evidence **before** accepting recovery. Checking backup freshness alone proves only that a snapshot exists, not recoverability.
4. Physical Android/iOS/Safari/weak-network and representative concurrency only to the extent not covered by valid, **same-environment** evidence; a new device/browser or ingress change is a meaningful trigger. Do not run a prolonged soak for every no-op deployment; reserve it for topology/capacity changes and agreed SLO thresholds.
5. Record release tag, source SHA, CI run links, non-sensitive operator evidence, timestamp, environment and explicit acceptance decision. **No repeat acceptance** for unchanged releases/configuration unless facts are time-dependent (capacity, certificate validity, backup freshness).

## Release artifacts and the no-extra-cost boundary

Current `onprem-staging.sh build --apply` builds from source on the operator host; Docker CI separately builds disposable verification images. **A shared signed/retrievable image registry or GitHub Actions image artifact is not implemented**. Do not claim "build once, deploy exact CI image digest" until images are actually published and their digest verified at deployment. Do not introduce GHCR/private registry storage or a paid backup provider without checking cost and obtaining authorization.

For now: reuse CI *test results*, avoid rerunning Nx/DB/Browser tests on IOT, build operator images **once per approved unique staging release tag**, verify deployment image identity through an operator-supplied SHA record, and prohibit `latest`/mutable release tags by policy. Rollback remains **images only**, schema-compatible and operator-approved; no destructive database auto-restore.

## Decision model

- **Accepted by valid evidence:** identical code/claim/environment; relevant provenance and no invalidating changes → no retest.
- **Targeted verification:** changing input, newly introduced host path, expiring cert, real OAuth, backup, or devices → test only missing proof.
- **Blocked:** policy/secret/access not approved, test failure, missing source provenance or unknown changed file → do not mark done or deploy.

Evidence register is auditable metadata, **not a bypass** for branch protection or production safeguards. Only the documented owner of B/#81 and C/#82 can supply operational signoff. Master tracker [#13](https://github.com/yiwssx/rcat-pos-system/issues/13) records current status.
