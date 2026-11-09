# RCAT POS — G4 B1/C operator handoff (9 November 2026)

**Status: superseded for C decisions by the 9 November 2026 owner approval in [#82](https://github.com/yiwssx/rcat-pos-system/issues/82) and the [B1–B6 operator runbook](G4-B1-B6-OPERATOR-RUNBOOK.md). The C1/C3 recommendations below were approved only for the four named metrics; C2 remains pending. ** This document is not evidence of host access, an authorized RCAT IOT deployment, a verified DNS/TLS route, Google OAuth, email delivery, offsite recovery, physical-device acceptance, or owner policy approval. See [#81](https://github.com/yiwssx/rcat-pos-system/issues/81), [#82](https://github.com/yiwssx/rcat-pos-system/issues/82), [#10](https://github.com/yiwssx/rcat-pos-system/issues/10), [#11](https://github.com/yiwssx/rcat-pos-system/issues/11) and [Lean evidence](LEAN-EVIDENCE-DELIVERY.md). No Payment/PromptPay before G5.

## 1 — B1: one targeted *initial-install* host probe

Existing [A1 packaging](ONPREM-STAGING-A1.md), [A2/A3 operations](ONPREM-STAGING-A2-A3.md) and historical CI are already completed and **must not be rebuilt as tests** merely to inspect an RCAT host.

The new read-only `scripts/ops/onprem-host-delta.sh` is designed to run **once on the approved IOT host, before the first staging install**, with the existing protected `.env.staging` and `.secrets/staging-pg-password`. It:

- Reuses the existing guarded `onprem-staging.sh preflight` check; rejects non-Staging, public bind addresses, insecure secret files and dev-auth.
- Verifies the reviewed bind IP is assigned, the three planned frontend TCP ports have no listening conflict, and no existing Docker Compose project named `rcat-pos-staging` is present.
- Reports **only aggregate free memory and free space on the source filesystem**, not credentials, environment values, user data or existing container details.
- Reports **capacity, ingress, OAuth and policy as PENDING**. It deliberately does not invent RAM/volume requirements, check an unapproved remote host, or modify Docker, firewall, DNS or the file system.

```bash
# On the approved RCAT IOT operator terminal, NOT from CI or a production container:
cd /opt/rcat-pos-system
bash scripts/ops/onprem-host-delta.sh
```

An existing POS Compose project intentionally blocks this *first-install* probe. For an already deployed staging instance, use the reviewed change/release procedure and the existing `onprem-staging.sh verify`, not a fake "free ports" test.

**Host-specific B1 evidence still needed:** time-stamped memory/disk output **with agreed headroom for PDF HUB/AnyFlip/Radio and PostgreSQL**, verified RMS ↔ IOT HTTPS/hostname/ports/firewall, no direct API/DB exposure, actual Docker resource availability, protected environment configuration, correct restricted database roles, and an operator authorization to deploy.

## 2 — C1: approved manual stock policy (9 November 2026)

**Conservative recommendation — retain the existing working behavior for G4.**

- The Merchant explicitly marks products unavailable (manual sold-out); do not claim automatic availability from ingredient balances.
- Recipe ingredient balance is atomically consumed when a Merchant **accepts** an Order, not when a Guest submits a cart.
- If two pending Orders compete for the same ingredient and insufficient stock remains, later acceptance fails atomically; Merchant resolves the shortage instead of silently accepting an unfulfillable Order.
- No checkout-time reservation, auto-sold-out, new inventory schema, or change to historical Order/stock snapshots without a separately approved specification.

**Owner approval: GIVEN for manual sold-out and on-accept consumption, not for automated reservation.** If the owner later chooses automated sold-out/reservations instead, create a scoped code change and new applicable CI proof before G4 acceptance; never silently change semantics.

## 3 — C2: unresolved offsite, cadence and retention (activation NOT approved)

- Keep the existing **24-hour expired Guest HMAC-budget** boundary. The daily DBA-only prune job can be enabled **only after** owner authorization. It does not delete Order or Outbox records.
- No automatic deletion of Order, unacknowledged Outbox, audit, session or media data until a documented access/retention/offline-device policy and legal review exist. No blanket destructive cleanup.
- Recommend a **daily encrypted offsite PostgreSQL backup** and a separately observed restore to an isolated database before calling recovery ready. Existing Restic hooks do not automatically choose/buy storage, implement remote snapshot pruning or prove that the backup can restore.
- Use only an already approved offsite location and storage budget; **do not** add a new billable subscription by default. Exact snapshot frequency, retention, offsite destination, RPO/RTO and authorized cleanup require owner signoff.

**Owner approval: PENDING specifically for the offsite destination, backup cadence, retention and guest-budget pruning.** Keep `RCAT_POS_BACKUP_POLICY_APPROVED=no` and `RCAT_POS_GUEST_RETENTION_APPROVED=no` until approval. The operator must never "flip" these merely to get a green check.

## 4 — C3: four approved numeric Staging targets; other numbers unapproved

The owner approved **only** Guest p95 2.5 s, Order p95 3 s, RPO 24 h and RTO 4 h. The 5xx, SSE and readiness numbers below remain merely proposed, **not owner-approved**; nothing is measured or passed on the RCAT host yet:

| Metric | Candidate acceptance threshold | Ground truth |
| --- | --- | --- |
| Guest menu load p95 | <= 2.5 s on agreed mobile/network profile | RMS HTTPS staging measurements |
| Guest Order submit p95 | <= 3 s under agreed representative load | real staging synthetic Orders, no payment |
| API 5xx | < 1% of synthetic eligible traffic during the approved qualification window | staging logs/metrics, excluding intentional negative tests |
| Merchant reconnect / authoritative replay | <= 15 s after the network is restored | physical-device test plus new RMS proxy path |
| Database backup RPO | <= 24 h | observed encrypted snapshot / recoverability |
| Isolated restore RTO | <= 4 h | timed independent restore drill |
| Readiness outage | <= 15 min recovery objective | observed /api/ready and operator incident workflow |

Only the four owner-approved numbers above are accepted targets; the other numbers remain proposals. No observed Staging values are available. The operator must record actual hardware and available network capacity, realistic workloads, documented exceptions, alert recipient and operator coverage. If these targets are unsuitable, the owner chooses different figures before acceptance; do not quietly lower them after a failure.

## 5 — Minimal execution order and stop conditions

1. **B1:** operator verifies protected staging inputs, runs the read-only delta check once, and establishes that RMS HTTPS + three **distinct origins** are feasible. A missing DNS hostname, TLS certificate, firewall permission, Docker access or acceptable resource headroom **blocks** deployment.
2. **C1/C3 owner-approved:** manual stock-on-accept plus four numerical SLO/RPO/RTO targets. **C2 pending:** Offsite/cadence/retention must be approved before backup activation and G4 final signoff. B evidence is still required.
3. **B2–B4:** with operator permission and staging-only credentials, configure three HTTPS origins and Google Workspace `@rcat.ac.th` callback; create separate restricted Auth/Tenant database logins; execute the existing guarded `build --apply`, reviewed migration after backup, `deploy --apply` and one local `verify`. Existing A1 runbook remains authoritative for exact procedures.
4. **B5–B6:** after retention approval, activate approved backup/monitoring, perform **one actual encrypted offsite isolated restore**, one HTTPS OAuth/CSRF + synthetic QR → Order `not_requested` → Merchant flow, new-proxy SSE reconnect, and targeted physical Android/iOS/Safari/QR/accessibility checks. Reuse valid GitHub CI; do not run full Nx/local CI/DB fixtures on the server.
5. **Release decision:** attach time-stamped, secret-free proof and operator/owner signoff to #81/#82; then reassess #10/#11. No live Payment, production traffic or open public DB/API endpoints.

### Explicit missing permissions / prerequisites

The repository integration can prepare branches, code, PRs and issues. It **cannot itself establish an SSH terminal on RCAT IOT/RMS, create Google OAuth credentials, change RCAT DNS, obtain offsite repository access, or choose owner policy**. None of those actions is evidenced merely by committing this handoff. Avoid asking the owner to repeat CI or perform manual tests; an authorized operator/automated staging process must produce the real host evidence.
