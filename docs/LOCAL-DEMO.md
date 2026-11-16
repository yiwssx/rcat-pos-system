# RCAT POS Local demo — single website

Use the canonical portal at **https://localhost:11880/** for all roles.
No Domain/Google OAuth/Email settings are needed in Local.

```bash
cd /opt/rcat-pos-system &&
sudo git pull --ff-only origin main &&
sudo bash scripts/ops/local-demo.sh up
sudo bash scripts/ops/local-demo.sh credentials
```

Use the generated `admin_demo@demo.invalid` (store owner) or `merchant_demo@demo.invalid` (manager) account. The page has a Local-only password
form and then shows the stores/tasks allowed for that account. No Admin/Merchant
application switch. Open **จัดการโต๊ะ / QR** for your store and press **เปิดรับออเดอร์**.
New or migrated stores start **closed** by default. The same permanent QR opens
the Guest menu without a code while open; while closed it shows the apology
screen. The owner can also open the Local sample table from the store card after
enabling ordering. No extra domain, OAuth, PIN or Payment settings are required.

From your computer, forward port 11880 through your **existing working SSH route**.
Keep its port/jump-host options. For an operator on the RCAT LAN, for example:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 11880:127.0.0.1:11880 rcat_iot_admin@10.10.1.100
```

Accept/trust the generated localhost certificate for this local demo. Service
Worker/PWA testing requires the certificate to be trusted by the browser/OS; do
not globally disable TLS verification. `/local` redirects to `/` for old bookmarks.

The startup script creates protected local passwords/TLS and an isolated database,
with two scoped accounts, one store, a table and three menu items. Repeated starts preserve its data and
passwords. Updating from the old three-port demo removes only orphan containers
in this Local Compose project; PostgreSQL data and protected secrets remain.
Missing secrets for an existing database fail safely rather than reset passwords.

```bash
sudo bash scripts/ops/local-demo.sh status
sudo bash scripts/ops/local-demo.sh stop
```

To intentionally clear **only** the isolated Local Demo database, old orders,
accounts and private Local Demo passwords, then recreate fresh `admin_demo`
(owner) and `merchant_demo` (manager), use:

```bash
cd /opt/rcat-pos-system
sudo bash scripts/ops/local-demo.sh reset --apply
sudo bash scripts/ops/local-demo.sh credentials
```

**Irreversible:** This removes the `rcat-pos-local_local_postgres_data` Docker volume.
It does not remove `rcat-pos-staging`, `.env.portal`, PostgreSQL Staging,
financial records, backups or bank configuration. The UI account labels do
not grant any cross-tenant platform-admin privileges. Real-funds pilot remains
separate from Local Demo and requires a protected merchant authentication flow.

Stop preserves data. No host API/database ports, schedules, retention or other
Compose projects are changed. No live payment in Local Demo. Never load real customer data into
the development-auth profile. See [the single-entry handoff](SINGLE-ENTRY-PORTAL.md)
for one-origin Staging configuration and the store QR opening policy.
