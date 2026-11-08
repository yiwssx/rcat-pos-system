# RCAT POS G4 On-prem staging A2/A3 — maintenance, monitoring and evidence hooks

**Code-only preparation.** Tracks [#80](https://github.com/yiwssx/rcat-pos-system/issues/80), [#81](https://github.com/yiwssx/rcat-pos-system/issues/81), [#82](https://github.com/yiwssx/rcat-pos-system/issues/82). The host is NOT configured, no scheduler installed, no live database contacted, no backup created, and no Payment/Production enabled.

## Operator prerequisites (B/C; not assumed completed)

- Working A1 staging Compose from [the on-prem runbook](./ONPREM-STAGING-A1.md), exact `RCAT_POS_ENVIRONMENT=staging`, IOT Linux host, reviewed dedicated restricted staging domains and credentials.
- Authorized operator account that can run Docker Compose; **Docker socket membership is root-equivalent**. Isolate account and audit all usage. Existing staging DBA password file is read **only** by opt-in maintenance container and PostgreSQL.
- A separately initialized **offsite, encrypted Restic repository**, e.g. a validated S3/SFTP/Rclone/B2/Azure/GS target. Install `restic` and `python3` on operator host. Do **not** store cleartext backups or Restic repo passwords in the Git repo.
- Define `RESTIC_REPOSITORY` and **absolute** `RESTIC_PASSWORD_FILE` (mode 600, no symlink) in the protected `.env.staging`. Remote credentials may require additional provider-specific protected environment variables. The tool will never initialize or delete a repository.
- Owner approves G4 snapshot frequency/encryption/offsite location, backup retention and restore RPO/RTO under **#82** before setting `RCAT_POS_BACKUP_POLICY_APPROVED=yes`. Approve expired Guest HMAC retention separately before `RCAT_POS_GUEST_RETENTION_APPROVED=yes`. Both default to **no**.

## A2: secure maintenance commands (operator only)

```bash
# Read-only CLI help and guarded preflight
bash scripts/ops/onprem-operations.sh help
bash scripts/ops/onprem-staging.sh preflight

# ONLY AFTER OFFSITE REPOSITORY, SECRETS, AND #82 POLICY ARE APPROVED:
bash scripts/ops/onprem-operations.sh backup --apply
bash scripts/ops/onprem-operations.sh backup-check
bash scripts/ops/onprem-operations.sh prune-guest-budgets --apply
```

Backup streams `pg_dump -Fc` from the isolated staging PostgreSQL 16 container directly to **encrypted remote Restic stdin**; it does **not** place a plaintext SQL dump on host disk. All PostgreSQL tenant/auth/order/outbox/inventory/media data are in the dump. A nonzero `pg_dump` or Restic exit code fails the backup, with no false success from a partial pipeline. The repository must already be configured and reachable; the script has no delete/forget/prune action.

`backup-check` reads tagged staging snapshots from the configured encrypted repo, emits only `fresh/ageMinutes/maxAgeHours/snapshotCount` JSON and fails when none is fresher than the configured threshold (default 26 hours, permitted 1–72). It does **not** verify content or recoverability; a **separate isolated restore with digest/RLS/Order replay and measured RTO** is required before closing G4. Never infer recovery guarantees from a successful upload.

`prune-guest-budgets` explicitly creates the **opt-in** Compose `budget_maintenance` process under the `ops` profile. It uses the existing privileged `g4-retention-maintenance.mjs`, deleting **only** expired Guest HMAC abuse buckets older than 24 hours. It cannot delete Order, Outbox, audit or user records. The normal API has no DBA secret mounted, and runtime login roles cannot execute the DBA function.

## A3: local non-payment readiness monitoring

```bash
# Read-only; requires staging env and reachable local published ports
bash scripts/ops/onprem-operations.sh readiness
```

`onprem-readiness.mjs` checks Customer, Merchant and Admin on the explicitly approved **local** bind address (127.0.0.1 or the reviewed IOT 10.10.1.100), each at `/`, `/api/health` and **PostgreSQL-backed** `/api/ready`. It verifies `paymentEnabled:false`, `productionReady:false`, expected API service and JSON/schema, with fixed 4-second HTTP timeouts and **no cookies or tokens**. It emits only a JSON status/latency summary; raw URLs, bodies and credentials are not logged. A failed check exits nonzero so an **operator-approved** systemd alert receiver, on-call process, or external monitoring platform can consume it.

Container liveness is **not** PostgreSQL readiness. These checks do not validate payment, real Google login, email delivery, orders/SSE/capacity, offsite restore, or public HTTPS availability; those remain B/Stage G4 acceptance. External uptime probes must use a separately approved HTTPS ingress and redacted logs.

## Optional systemd templates — **NOT INSTALLED**

Reference-only, never copied/enabled automatically:

- `infra/onprem/systemd/rcat-pos-staging-ops@.service.example` — one-shot policy-gated jobs, account `rcat_pos_ops`, explicit `--apply` (ignored by read-only readiness).
- `infra/onprem/systemd/rcat-pos-staging-backup.timer.example` — daily with delay. Only install when policy #82 and B operator are ready.
- `infra/onprem/systemd/rcat-pos-staging-guest-budget.timer.example` — daily expired Guest bucket cleanup only.
- `infra/onprem/systemd/rcat-pos-staging-readiness.timer.example` — 5-minute local health sampling; **an alert/on-call receiver is not yet configured**.

These templates assume repository location `/opt/rcat-pos-system` and a provisioned `rcat_pos_ops` account authorized to use Docker and read protected staging config, plus appropriate systemd sandbox review. Do **not** install these templates as-is on RMS or unrelated host workloads. Host, DNS, firewall, monitoring receiver and offsite retention remain #81/#82.

## Validation and exit conditions

The Foundation CI now runs `tests/ops/onprem-operations.test.mjs` using synthetic snapshots and loopback-only HTTP servers. The On-prem staging image workflow builds all four targets and Docker tests the maintenance script packaging. **Neither CI nor these templates prove real offsite backups, alert routing or operator policy.**

- [x] Versioned, safe operator interfaces and explicit `--apply`/policy gates.
- [x] No plaintext host archive; offsite Restic-only backend, restricted tagged freshness check.
- [x] DBA-only expired Guest budget maintenance in isolated opt-in container; no Order/Outbox delete.
- [x] Read-only local three-origin health/readiness monitor and offline automated regressions.
- [ ] C policy and operator permissions, actual remote encrypted backups, successful isolated restore, scheduled jobs, external alarms, RMS proxy TLS/physical browser/traffic tests, actual host acceptance.

A4/A5 load/device automation continues under #80; G5 Payment last.
