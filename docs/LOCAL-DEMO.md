# RCAT POS Local Demo

This is the owner-requested local demonstration under #81. It uses the existing
Angular/NestJS images and development password authentication. No Domain, Google
OAuth, Email provider or `.env.staging` input is required. Payment remains absent.
This demonstration does not satisfy B2–B6 or close G4 staging acceptance.

## Start on RCAT IOT

From the existing checkout, run:

```bash
cd /opt/rcat-pos-system &&
sudo git pull --ff-only origin main &&
sudo bash scripts/ops/local-demo.sh up
```

Docker Compose v2, Git, OpenSSL and `ss` are required. The first launch downloads
images and builds each application; subsequent launches reuse Docker's build
cache. No Nx/test suite runs on IOT. Start fails if the local ports are occupied;
it does not stop any other service. Failure leaves demo resources available for
diagnosis; fix the reported error and run `up` again.

The script generates protected local passwords, database connections, table-code
pepper and a self-signed localhost certificate automatically. Existing passwords,
menus and orders are preserved on repeat starts. If configuration/secret files
are lost while the database still exists, it refuses to generate replacements.
Do not delete the secret files to reset a failed launch.

Show the generated demonstration account in your private operator terminal:

```bash
sudo bash scripts/ops/local-demo.sh credentials
```

Do not paste its password or `.env.local` into issues/chat. `.env.local` and
`.secrets/local-demo/` are excluded from Git and Docker build contexts.

## Open from your computer

In Windows PowerShell (or your own SSH client), forward three ports using your
**existing working SSH route** to IOT:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 11880:127.0.0.1:11880 -L 11881:127.0.0.1:11881 -L 11882:127.0.0.1:11882 rcat_iot_admin@10.10.1.100
```

The LAN example applies when your computer can reach `10.10.1.100`. If your normal
SSH session uses an alias, jump host or custom port, retain those connection
options. No new remote access path or public SSH route is created by this work.
Keep the forwarding terminal open. A browser on IOT itself needs no SSH forwarding.

Use **localhost**, consistently, for all three addresses:

| Application | Address |
| --- | --- |
| Demo login / launcher | https://localhost:11881/local |
| Customer | https://localhost:11880/ |
| Merchant | https://localhost:11881/ |
| Admin (tenant owner tools) | https://localhost:11882/ |

Each origin uses a generated self-signed certificate. On your first visit to
each address, the browser asks you to trust/continue to that **local demo** site.
For PWA/Service Worker testing, trust the generated certificate through your OS or
browser certificate store; a certificate-warning exception alone may not enable
Service Worker registration. Do not globally disable browser TLS verification.

## Try the seeded store

1. Sign in at `/local` as `owner@demo.invalid` with the generated password.
2. Choose Merchant or Admin to open the actual applications. Both use the same
   host-scoped Secure session cookie on localhost. The Google sign-in link in
   these unchanged applications returns to the local launcher in this profile.
3. Choose **เริ่มรอบโต๊ะและเปิด Customer**. This issues a fresh code through the
   existing authenticated/CSRF-protected API, redeems it, then opens the actual
   guest ordering page. This deliberately revokes the previous demo table round.
4. Order a demo meal and open Merchant in another tab to accept the order.
   The order payment state remains `not_requested`.

Fixtures: one owner, one tenant, ร้านทดลอง RCAT, one table, and three menu items
(ข้าวกะเพรา 45 บาท, ข้าวผัด 40 บาท, น้ำดื่ม 10 บาท). No real personnel accounts,
customer data or bank details. Admin provides the existing **tenant owner**
functions; this does not introduce global platform-admin permissions.

The launcher has keyboard labels, visible focus, pending/disabled buttons, inline
errors and no credential persistence in browser storage. Wrong password/expired
session, CSRF denial, timeout/offline, unavailable table and a repeat click fail
visibly; retry is explicit. It does not retry mutations automatically. At 320px
it stacks the login controls and wraps navigation. It is mounted only by the
local manifest, outside all production Angular bundles.

## Stop or inspect

```bash
sudo bash scripts/ops/local-demo.sh status
sudo bash scripts/ops/local-demo.sh stop
```

Stop preserves data. No command deletes volumes, schedules backups or changes
retention. Project `rcat-pos-local`, volume `rcat-pos-local_local_postgres_data`,
database `rcat_pos_local_demo` and image tags `rcat-pos-local-*` are independent
of staging. PostgreSQL and NestJS have **no published host ports**; only the three
web ports bind to `127.0.0.1`. The local Nginx configuration rejects non-localhost
Host headers and retains Secure/HttpOnly cookies and CSRF. Auth/Tenant runtime
logins remain distinct and unprivileged; the DBA secret is given only to the
database and opt-in migration/seed processes.

Do not attach an external proxy, publish on the LAN or load real data into this
development-auth profile. Real staging still uses its existing HTTPS/OAuth/backup
gates. `.env.staging`, Production, DNS, Cloudflare and other host services are
not modified by this profile.
