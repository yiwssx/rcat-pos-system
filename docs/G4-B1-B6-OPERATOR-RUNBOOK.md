# RCAT POS — G4 B1–B6 Operator Execution Packet

**Approval record: 9 November 2026.** Only [C1 stock and C3 targets](./g4-staging-owner-policy.json) have been approved. **C2 offsite/cadence/retention is NOT approved.** This handoff prepares Staging; it does not authorize remote access, host changes, DNS changes, payment functionality, a production release, paid backup services or automatic cleanup. Tracking: [#81](https://github.com/yiwssx/rcat-pos-system/issues/81), [#82](https://github.com/yiwssx/rcat-pos-system/issues/82), [#10](https://github.com/yiwssx/rcat-pos-system/issues/10), [#11](https://github.com/yiwssx/rcat-pos-system/issues/11).

## Approved business invariants

- C1: Merchant manually marks sold-out items. Ingredient stock is consumed **only on Merchant acceptance**; a shortage makes that acceptance fail atomically, rather than booking unavailable ingredients. No checkout-time stock reservation or automated sold-out.
- C3: Guest menu p95 <= **2,500 ms**, Guest Order submission p95 <= **3,000 ms**, encrypted backup **RPO <=24 h**, independently measured isolated-restore **RTO <=4 h**. These are targets awaiting real Staging proof, not assumed baselines.
- C2: **Offsite location, backup cadence and retention are pending selection.** Do not enable `RCAT_POS_BACKUP_POLICY_APPROVED`, `RCAT_POS_GUEST_RETENTION_APPROVED`, systemd timers, Restic jobs or any data deletion. RPO <=24h is a recovery objective, **not** approval of a daily cron schedule.
- API 5xx, SSE replay and incident-response targets mentioned in the earlier proposal were **not approved as numbers**. Keep qualitative reliability requirements, collect measurements, and ask owner for numbers if necessary.

## B1–B6 scope, dependency and accountable evidence

| Stage | What the authorized operator must establish | Primary reusable tools | Real evidence (secret-free) | Gate |
| --- | --- | --- | --- | --- |
| **B1 — host delta** | IOT resources/collisions and no impact to PDF HUB/AnyFlip/Radio; staging-only file permissions and LAN binding | `onprem-host-delta.sh`, `onprem-staging.sh preflight` | Current capacity and port headroom, approved ingress/firewall owner, time-stamped operator record | No deploy if insufficient headroom or missing operator access |
| **B2 — ingress** | Three separate customer/merchant/admin HTTPS origins; verified RMS↔IOT ingress, TLS, trusted XFF, no direct API/DB, correct SSE timeouts | [A1](ONPREM-STAGING-A1.md), [proxy policy](G4-OPS-RETENTION-AND-STAGING-SOAK.md) | Verified HTTPS responses and review of RMS/edge config (redacted) | No guessing DNS names or trusting arbitrary proxy CIDRs |
| **B3 — auth/secrets** | Staging-only restricted Auth/Tenant logins, independent DBA, Google Workspace `@rcat.ac.th` client/callback, email-delivery/recovery verification; disabled dev auth | Protected `.env.staging`, `onprem-staging.sh config` | Owner-approved config location, real Google login + CSRF/cookie check and delivery proof without tokens | Never paste secret values in Issues or environment reports |
| **B4 — non-payment install** | One unique reviewed code release, reviewed migrations/backup boundary, launch isolated Compose, verify true DB dependency and synthetic Guest QR→Order`not_requested`→Merchant acceptance | `onprem-staging.sh build --apply`, `migrate --apply`, `deploy --apply`, `verify`; [Lean CI](LEAN-EVIDENCE-DELIVERY.md) | Release SHA, exact image tag, targeted readiness/API/auth/order evidence | **Do not run mutating commands until B1–B3, pre-migration backup protection and operator deployment permission exist** |
| **B5 — recovery/ops** | Approved encrypted *offsite* Restic target, retention/frequency, isolated restore with RPO/RTO, monitoring recipient and rollback rehearsal | [A2/A3](ONPREM-STAGING-A2-A3.md), `onprem-operations.sh` | Approved policy, backup destination custody, real backup/restore timed evidence | **BLOCKED while C2 is pending** |
| **B6 — acceptance** | Real Android/iOS/Safari printed QR, weak-network/sleep and a11y, actual large-catalog p95, Order p95, SSE replay on new ingress, two-replica proof if topology warrants | [A4/A5](ONPREM-STAGING-A4-A5.md), bounded read probes | Redacted device/version/latency/proxy/Order and owner/operator signoff | G4 cannot close without B1–B5 and C2 including restore |

### Explicit no-repeat CI rule

Existing A1–A5 and CI evidence is reused if exact code/config/environment scope still matches. No local `pnpm`/Nx/RLS/Chromium full-suite retest on the RCAT IOT host. Build the unique staging image **once per operator-approved release**; the checked-in CI does not publish a release image to deploy. One local `verify` and a targeted new-environment OAuth/Order/restore/device acceptance are justified; repeated identical probes are not.

## Operational order (NOT commands for the user to run)

1. Authorized IOT/RMS operator determines permitted staging host and origins. Before first install, prepares secret-protected `.env.staging` and runs read-only `bash scripts/ops/onprem-host-delta.sh` and `bash scripts/ops/onprem-staging.sh config` on the target host. Do not run these on Production or as generic diagnostic scans.
2. Operator and domain owner review the *new* POS RMS reverse-proxy configuration: if RMS runs on another host, the three POS containers cannot remain bound only to `127.0.0.1`; approved IOT LAN `10.10.1.100` binding requires appropriate RMS-only firewall before changing `RCAT_POS_HOST_BIND_IP`. Do not reuse AnyFlip/PDF route claims as proof.
3. Operator provisions unique protected staging-only secrets, distinct `rcat_auth`/`rcat_app` runtime logins and separate migration DBA; authenticates a permitted `@rcat.ac.th` user using real HTTPS redirect URI. External domain/Google/mail settings require actual authorized credentials; do not invent placeholders as real routes.
4. **When operator deploy approval and safe migration/backup prerequisites exist**, run existing guarded staging build/migrate/deploy once and observe health **and** `/api/ready` for each origin. Never bypass `--apply` protection or automatically restore a database. If C2 is still unresolved, do not claim B4 full acceptance from an unprotected database.
5. **After owner approves C2 in a new decision**, provision an already-approved offsite destination, secure encryption and rotation, activate only the approved schedule, capture one real encrypted snapshot and one timed isolated restore (RPO <=24h, RTO <=4h); set up a real alert destination and accountability for failures. No automated guest-budget pruning without its own retention approval.
6. Operator executes a **single bounded acceptance campaign** for the new on-prem topology, using synthetic non-payment Orders and real devices managed by the operator. Record p95 values and distinct observations for B1–B6. Any failure reopens only the changed subsystem; do not blanket-run local CI.
7. Store **redacted evidence** in a private/authorized change record and link it from GitHub as allowed. Do not include cookies, visit tokens, staff identities, raw customer content, IP addresses from individuals or credentials.

## Automated acceptance index (read-only; NOT host verification)

- Machine-readable owner record: [`docs/g4-staging-owner-policy.json`](./g4-staging-owner-policy.json).
- Evidence schema *example*: [`docs/g4-staging-evidence.example.json`](./g4-staging-evidence.example.json) — all fields default PENDING; it is not a record of results.
- Check policy *consistency only*, from repository CI: `node scripts/ops/g4-staging-acceptance.mjs --policy-only`. An exit code 0 here means JSON consistency, **not** G4 acceptance.
- Given a separately gathered, reviewed operator-only JSON file, run `node scripts/ops/g4-staging-acceptance.mjs --evidence /private/path/evidence.json`. This command only reads files and emits non-sensitive stage/threshold blockers. **Exit 2 = blocked**; **exit 0 = candidate for independent manual review**, never automatic Production authorization.
- No GitHub Action, repository commit, mock, CLI output or uploaded log can itself attest the truth of an external HTTPS/host test. Current C2 makes the gate block even if someone fabricates every B1–B6 status as verified.

### Outstanding decisions / blockers

- **B1–B3:** actual authorized host operator/session and RCAT DNS/TLS/Google/mail configuration and approved deployment-change window.
- **C2/B5:** approved Offsite destination + cadence + retention policy; ensure target can meet RPO/RTO **with a real restored database**.
- **B4/B6:** deployment and observed staging proof and operator/owner final signoff; #81/#82 remain open.
- G5 per-Order PromptPay and G6 Production remain completely out of scope.
