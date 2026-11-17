# Closed RCAT Workspace Access — Super Admin / Admin / Merchant

**Owner policy (17 Nov 2026):** Only authorized `@rcat.ac.th` Google Workspace accounts may sign in to the private RCAT POS staff portal. **No public signup and no automatic staff enrollment.** This policy supersedes any suggestion to auto-register everyone in the Google Workspace domain.

## Role matrix (platform authority vs tenant scope)

| Identity | Platform access and user approvals | Merchant/tenant privileges |
|---|---|---|
| `admin@rcat.ac.th` — **Super Admin** | Unique, immutable bootstrap identity after a valid signed Google ID token; may grant/suspend Admin or Merchant, list all tenants; may explicitly enter any tenant with audited Owner membership | Can manage any store **after** explicitly entering that tenant; existing Tenant RLS/owner checks still apply |
| **Admin** — appointed by Super Admin | Can grant/suspend Merchant, list the approved roster and tenant list, assign Merchant to existing tenants; **cannot** grant or revoke Admin, modify Super Admin, or take over arbitrary tenants | Own separately granted tenant permissions only |
| **Merchant** — approved by Super Admin or Admin | No platform administration; may log in after approval | Tenant **owner** permissions when assigned to a tenant by central admin; existing merchant staff roles remain tenant-scoped |
| **Guest/customer** | Does not use staff login | Existing QR ordering remains guest-facing; no staff session or tenant administration |

Existing tenant roles `owner/manager/cashier/kitchen` remain intact. Platform roles **never automatically bypass RLS**. The initial Super Admin enters another tenant through an audited, explicit action before exercising tenant Owner rights; Admin does not inherit that power.

## First login and onboarding

1. Authorized operator applies checked migration `042_closed_platform_access.sql` to the existing isolated Staging PostgreSQL after verifying a valid safety backup. Do not reset or recreate the existing database.
2. The holder of **`admin@rcat.ac.th`** selects that Google Workspace identity. The API validates Google JWT signature, audience, issuer, nonce, `email_verified`, `hd=rcat.ac.th`, PKCE/state, and then the SQL function bootstraps **only this fixed identity** as Super Admin. An unrelated `@rcat.ac.th` address cannot bootstrap itself.
3. Super Admin opens **/platform** and adds a named `@rcat.ac.th` address as **Admin** or **Merchant**. Admin can add **Merchant** only. The API checks session, CSRF, exact Origin; the database rechecks the platform role in SECURITY DEFINER functions and records grants/suspensions with actor and subject.
4. Approved Merchant signs in, then Super Admin/Admin selects the Merchant and assigns them to an existing tenant; assignment creates an audited **tenant Owner** membership, not global access. To create a brand-new tenant, Super/Admin uses the existing authenticated **/settings** creation flow.
5. Suspension marks the user inactive and revokes all active sessions. Re-enabling is manual; a recreated Google Workspace subject does not silently overwrite a previously bound Google identity. Identity rebinds require an independently reviewed offboarding/recovery procedure.

**Important:** The Super Admin username is a role root, **not** a password bypass. It must be protected by Google Workspace admin controls and enforced MFA; it does not exist in CI/Host unless Google OAuth or the isolated synthetic test explicitly provisions it. Never expose OAuth client secrets, Google authorization codes, cookies or passwords in GitHub, shell outputs, screenshots or chat.

## Operator acceptance (Staging-only, no Production)

- Migration 042 schema and role grants, SQL rollback/backup constraints and pre-existing role checks.
- `admin@rcat.ac.th` real Google login -> `GET /api/auth/me` returns `platformRole=super_admin` -> `/platform` opens.
- Unknown `@rcat.ac.th` account is **denied**, without revealing whether it exists.
- Super creates Admin; Admin cannot create Admin, mutate or revoke root, or access other tenants.
- Super/Admin creates Merchant, assigns tenant; Merchant can access **only** assigned store/tenant.
- Suspend Merchant -> existing session revoked; login denied. Google subject recycling remains rejected.
- Password login remains disabled in Google-only Staging; guest QR ordering unaffected.
- No live PromptPay, bank receiver, offsite timer or Production release is activated by this change.

Real host deployment, OAuth provider configuration, Google MFA, real account UAT, backup/restore and G6 go/no-go remain separate owner-controlled #81 gates. Reuse CI evidence; do not duplicate full CI checks on IOT.
