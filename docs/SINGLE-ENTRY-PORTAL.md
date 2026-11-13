# Single-entry RCAT POS portal

Owner decision (13 Nov 2026), tracked under existing #81: one website and entry
point; guest QR ordering without login; staff/owner navigation follows existing
server-granted store memberships. The owner configures Domain/OAuth/host settings.

## Implementation and acceptance

- Canonical Angular application: `customer`. It lazy-loads the existing Merchant
  order/catalog/table/inventory/report pages and owner settings/staff pages. This
  reuses business components without copying their transaction logic.
- One App Shell, session state and workspace. No role picker or application switch.
  Navigation is generated from the authenticated store scope and active store.
- Existing operation URLs (`/orders/...`, `/catalog/...`, `/tables/...`, etc.) stay
  valid on the same origin. Guests open `/order` from a QR and `/order/track` from
  their saved order-only capability. Staff open `/` and sign in once.
- Session loading and unavailable/retry states do not display login prematurely.
  Route guards hide/reject ineligible workspaces; API authorization/RLS remain the
  actual privilege boundary. Logout and API 401 clear the shared frontend state.
- Owner tools are `/settings` and `/tenants/:tenantId/staff`. These are existing
  tenant-owner permissions, **not** new global platform-admin privileges.
- The Merchant/admin Nx projects remain as reusable feature sources and historical
  standalone development fixtures. `customer` explicitly depends on both in Nx;
  its canonical deployment is a single compiled Angular site, not iframe/redirect
  switching among the three apps. Their legacy deploy manifests are not the
  single-entry deployment path.
- The canonical portal's Service Worker caches vetted public static assets only.
  Never cache API, authenticated HTML, mutations, guest/order data or logout.

The first screen introduces QR ordering and a single staff login; authenticated
users see their stores with task links, then a store-scoped sidebar (scrollable
on small screens). The existing orange identity and Thai typography are retained.
Keyboard labels/focus, 320px wrapping, disabled pending actions and explicit
error/retry states are part of the acceptance. Wrong password, expired session,
API outage, guessed foreign-store URL, unprivileged owner-settings URL and logout
must not reveal/retain a privileged workspace. No new payment interaction.

## Local update

Use the existing operator command after pulling the reviewed merge:

```bash
sudo bash scripts/ops/local-demo.sh up
sudo bash scripts/ops/local-demo.sh credentials
```

Open **https://localhost:11880/**. Forward only port 11880 through the operator's
working SSH connection. `/local` redirects to `/` for old bookmarks. There is no
separate Merchant/Admin port. Compose removes the old same-project orphan web
containers during `up` while retaining the existing PostgreSQL volume and all
protected Local secrets. Other Compose projects are untouched.

The Local Nginx runtime config permits the demonstration login UI; backend
password auth still requires development mode. Production/Staging static config
is false and cannot enable password auth server-side. The protected owner account
also has a Local-only sample-table button that rotates a visit link through the
normal authenticated/CSRF-checked API. Guests in real staging scan the store QR.

Known separate issue: printed eight-digit code grants still have the previously
recorded tracking-bind gap; the Local sample button uses the established
staff-issued visit link. This frontend change does not qualify that flow.

## User-owned single-origin Staging configuration

Use **compose.portal.yaml**, with a protected `.env.portal` based on
`.env.portal.example`. The existing three-origin `compose.staging.yaml` and its
operator script remain the legacy path; do not combine the two manifests.

- `RCAT_POS_PUBLIC_ORIGIN`: one HTTPS origin, for example `https://pos.rcat.ac.th`
  (no trailing slash, credentials, query, fragment or application path).
- Configure the same origin's `/api/auth/google/callback` as the Google redirect.
  Successful Google login returns to `/`, which opens the same role-aware portal.
- The manifest derives CORS, auth origin and the Customer `/order` base from this
  one public origin. The operator supplies OAuth credentials, independent Auth
  and Tenant database logins, DBA password file, unique release tag and Guest
  table-code pepper. See `.env.portal.example`. Never commit the actual files.
- Only the canonical `customer` web service is published. Default example port
  11890 avoids the Local 11880 listener; validate the actual port before use.
  API/PostgreSQL remain unpublished. The default host bind is loopback; an RMS
  proxy on a different host needs an explicitly reviewed LAN/firewall route.
- Route all HTTPS requests for the selected hostname to this one web endpoint.
  Its Nginx proxies `/api/` to the private API and serves the canonical Angular
  index for navigation. Keep SSE buffering off and existing trusted-proxy rules.
- Preserve the existing protected staging PostgreSQL volume/DB if already present.
  A migration, DBA role setup or different release requires the existing safety
  review/pre-migration backup boundary; no automatic database reset or restore.

The following parser/build examples prepare the operator's selected configuration;
**they are not evidence of a host deployment**:

```bash
docker compose --env-file .env.portal -f compose.portal.yaml config --quiet
docker compose --env-file .env.portal -f compose.portal.yaml build api customer
```

Only after valid HTTPS/OAuth, runtime DB roles, migration/data-protection and
operator prerequisites exist may the operator start the stack and collect the
new-environment evidence. Existing #81/#82 remain OPEN for real staging/recovery.
No DNS, OAuth credential, server deployment, offsite policy or backup schedule is
changed by this PR. No live Payment or Production release.
