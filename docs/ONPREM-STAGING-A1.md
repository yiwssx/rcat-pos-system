# RCAT POS G4 — On-premises Staging packaging (A1)

**Status: code/configuration preparation only; no RCAT server/DNS/Production deployment performed.** Tracks [#80](https://github.com/yiwssx/rcat-pos-system/issues/80), [#81](https://github.com/yiwssx/rcat-pos-system/issues/81), [#82](https://github.com/yiwssx/rcat-pos-system/issues/82). **No PromptPay/Payment** until G5.

## Proposed fixed topology

- RCAT IOT Ubuntu server (candidate LAN IP `10.10.1.100`): one isolated Compose project `rcat-pos-staging`, PostgreSQL 16 named volume, private NestJS API network, three Angular static Nginx apps on **different origins** (ports 11880–11882).
- Existing RMS HTTPS reverse proxy is a **candidate**, not already configured. It must terminate TLS, route exact hostnames to the three IOT LAN ports, restrict IOT reachability to approved RMS ingress, and ensure `/api/*` retains **the originating frontend hostname** so `__Host-` cookies, Google callback, Origin and CSRF match. Never expose PostgreSQL or the NestJS port.
- RMS must overwrite/append actual incoming client IP in X-Forwarded-For; container Nginx appends its immediate peer and forwards Host. Configure `GUEST_TRUSTED_PROXY_CIDRS` only after validating the observed socket peers and trusted chain. Never trust Internet-wide CIDRs or permit direct bypass; verify NAT fairness with two unrelated clients.
- The three Nginx static containers use the same config but different Angular distributions and per-host scopes. `/sw.js` is available **only** in Merchant. Client/merchant/admin same-host `/api/*` proxying avoids cross-site cookies.

## Components and security boundaries

| Item | Implementation | Gate |
| --- | --- | --- |
| Angular Customer/Merchant/Admin | Dockerfile.staging multi-stage Node 24/pnpm 10 build → independent Nginx static images | Build in CI and real HTTPS verification required |
| NestJS API | Same build, Node 24 runtime under unprivileged `node`; `RCAT_API_BIND_HOST=0.0.0.0` only inside private Docker network | `/api/health` is process liveness, `/api/ready` requires restricted DB roles and schema |
| PostgreSQL 16 | Separate container and named volume; DB network `internal:true`, **no published ports** | Independent backup, credentials and tested restore required |
| Migration | `migrator` under opt-in Compose `ops` profile, reads a restricted password file, invokes existing checksum-enforced `scripts/db/migrate.sh` | Explicit operator `migrate --apply` only, after backup |
| Secrets | Staging-only operator `.env.staging` and `.secrets/` (ignored by Git), file modes 600 | Docker admins can inspect container env values: restrict Docker/host access; consider secret-file API integration before wider rollout |
| Health/rollback | `scripts/ops/onprem-staging.sh` with protected preflight and explicit mutating actions | Never use CI test credentials, auto-restore DB, or mark ready on /health alone |

The committed `compose.db.yaml` is **development-only** and must not be used as a staging manifest. The `api` and `postgres` services intentionally have **no host published port**. The three Nginx ports must bind either to `127.0.0.1` (initial safe default) or the reviewed `10.10.1.100` LAN address. **Firewall allowlisting RMS is required before choosing the LAN binding.**

## Preparation (operator; these commands have NOT been executed)

1. Review host resources (IOT workloads: PDF HUB, AnyFlip, Radio), free disk/backup target, supported Docker Compose, network ingress/DNS/TLS, credentials, firewall and dedicated data directory before using this configuration.
2. Prepare secret files **outside Git**. Use `.env.staging.example` as a template without reusing its placeholder values, `chmod 600 .env.staging`, and create `.secrets/staging-pg-password` with mode 600. Provide an **absolute** `RCAT_POS_DB_PASSWORD_FILE` path. All DB URLs are restricted **different login roles**.
3. Verify exact HTTPS Customer, Merchant and Admin origins, Google Workspace Client ID/Secret and callback. `AUTH_ALLOWED_ORIGINS` must include the merchant callback origin. No dev/test authentication or real Payment.
4. Run **read-only/offline** checks:

   ```bash
   bash scripts/ops/onprem-staging.sh preflight
   bash scripts/ops/onprem-staging.sh config
   ```

5. After separate operator approval and safe host setup, build immutable release tags using `bash scripts/ops/onprem-staging.sh build --apply`. Only the operator may initiate this command.
6. With a dedicated DBA identity (not API runtime roles), run `bash scripts/ops/onprem-staging.sh migrate --apply` **after** capturing a verified backup. This creates SQL roles such as `rcat_auth` and `rcat_app` but does not provision login accounts. Operator must separately create **distinct** NO-SUPERUSER/NOBYPASSRLS logins and grant only the corresponding `rcat_auth`/`rcat_app` role memberships. Set independent login passwords via approved secrets process; never commit or paste them into shell history. The API must not connect as the staging DBA.
7. After migration/roles/OAuth review, operator may run `bash scripts/ops/onprem-staging.sh deploy --apply` then `bash scripts/ops/onprem-staging.sh verify`. Run real external HTTPS tests separately: valid Google OAuth, Cookies/CSRF, printed QR, Guest Order `not_requested`, Merchant PWA/SSE, absence of Payment and successful restricted DB `/api/ready`.

## Releasing and rollback

- `RCAT_POS_RELEASE` is an explicit **immutable-by-policy** non-`latest` staging image tag. Reuse is forbidden operationally: each accepted build must have a new tag and documented Git SHA.
- `rollback --apply OLD_TAG` requires **`RCAT_POS_ROLLBACK_SCHEMA_APPROVED=yes`** and all four previously-built app images to be present. It only switches API/Angular **images**, never reverses migrations, truncates/orders DB data, or restores backups. Schema backward compatibility and audit must be reviewed before use. After switching images, run `verify` and external HTTPS/Google/SSE tests. No automatic destructive restore.
- A successful Docker Compose liveness healthcheck does **not** close #10/#11. Remain staged-only until OAuth/email, proxy trust/NAT, DB restore/backup scheduler, alerts, two-replica SSE, Android/iOS/Safari/accessibility, and sustained load evidence exist.

## Known engineering gaps / follow-on

- A2/A3: production-grade backup job, retention, observability alert delivery and a safe offsite target under #80 and owner policy #82. Existing DBA CLI only prunes **expired Guest budget buckets**; never unacknowledged Outbox.
- A4/A5: extended sustained load, two-replica proxy SSE and device test harness. Physical iOS/Safari cannot be certified by Chromium CI.
- This packaging does not provision secret stores, SMTP/Resend, Google Accounts, external DNS, RMS or the IOT host. They belong in #81 with explicit operator evidence.
