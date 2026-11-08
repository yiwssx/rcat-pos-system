# G4 Operations: bounded retention + staging read qualification

**Engineering tools only.** Does not deploy, change Production, purge Order
Outbox, accept real money or enable Payment/PromptPay. Supports #10/#11/#13.

## Operator retention workflow (Batch B)

Use the existing PostgreSQL `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER` and `PGPASSWORD` configuration for a separately authorized DBA
or dedicated maintenance role. **Never use** application
`AUTH_DATABASE_URL` / `TENANT_DATABASE_URL` credentials.

```bash
node scripts/ops/g4-retention-maintenance.mjs report
node scripts/ops/g4-retention-maintenance.mjs prune-guest-budgets --apply
```

- `report` is a read-only transaction. It returns aggregate Guest abuse
  budget counts and the 100 stores with most Outbox Events older than 30 days.
  Recorded staff cursors are **not proof** that every offline/entitled device
  received the event; the query does not delete anything.
- `prune-guest-budgets --apply` is explicitly writable, checks an advisory
  transaction lock and strict statement/lock timeouts, then calls the
  DBA-only `rcat_private.prune_guest_request_budgets()`, which deletes
  Guest HMAC subject buckets **older than 24 hours only**. On a
  `NODE_ENV=production` operator workstation it additionally requires
  `--production-approved`; do not execute it against Production until the
  human change-control process has separately approved retention and
  scheduled backups.
- Neither the reporting nor cleanup script has an Order/Outbox DELETE path.
  The service runtime role has no direct table privilege and no execute
  permission on the prune function. SQL CI verifies both privilege denials
  and that current abuse evidence is preserved.
- The script does **not create a cron job**. The operator must review
  retention/compliance rules, grant a least-privileged DBA maintenance
  identity, install an appropriately monitored daily scheduler, and
  provide execution/backup/restore evidence on Staging before signing G4.

## Safe staging Guest read-load qualification (Batch C)

This script sends only read-only, Origin-validated Guest catalog page
requests and **never submits Orders, mutates stock or performs Payment**.
It hard-rejects production hostnames (must contain `staging` or `uat`
as a DNS label/component); CI may use only loopback HTTP.

For a controlled Staging environment after proper QR/grant provisioning:

```bash
RCAT_STAGING_API_URL=https://staging-pos.example.ac.th/ \
RCAT_STAGING_CUSTOMER_ORIGIN=https://staging-order.example.ac.th \
RCAT_STAGING_VISIT_TOKEN="<staging-only bearer; keep private>" \
RCAT_SOAK_REQUESTS=60 RCAT_SOAK_CONCURRENCY=4 \
node scripts/load/staging-guest-read-soak.mjs
```

- Caps: 1–60 requests per execution, 1–8 concurrent workers, eight-second
  request timeout. Default is 60 read requests / 4 workers. The cap
  intentionally stays below the 120-per-minute single-visit budget.
- Emits JSON status-code histogram, response-schema failures, p50/p95/max
  latency. Fails on incomplete 201 responses, network errors, HTTP 429 or
  5xx; these are clues for staging investigation, not proof of an outage.
  Tokens, response bodies, and request URLs with secrets are **never logged**.
- CI uses a dummy local HTTP server and probes invalid production targets,
  excessive load, and missing explicit pruning approval. This proves tool
  guardrails, **not real staging capacity**.
- Multi-replica SSE, Android/iOS deep sleep, real edge proxy/NAT fairness,
  TLS, OAuth, SMTP, offsite backup/restore, alert routing, 500+ item
  sustained-load SLO, accessibility, and live operator runbooks still
  require Staging/physical evidence. G5 PromptPay remains last.
