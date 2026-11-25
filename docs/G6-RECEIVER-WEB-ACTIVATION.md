# G6 — Receiver activation in the Merchant web portal (code-only)

Refs #81 (G4/G6 owner release), #7 (manual PromptPay M1).

## Staff journey
1. The authorized Owner/Manager opens **ตั้งค่าบัญชีรับเงิน**. A configured PromptPay ID remains masked and does not need to be retyped.
2. **เปิดรับชำระเงิน** becomes available only when the currently saved receiver revision was independently approved for this store **and** the API's QR+slip release controls are enabled under production Google-only auth.
3. Owner/Manager may pause and resume the *same approved recipient* in the web UI. No CLI is needed for routine toggles; status reload prevents stale changes.
4. Changing the receiver, a DBA emergency stop, or an operator revoke invalidates web reactivation and requires new independent approval. Payments and historical financial evidence are not deleted.

## Non-negotiable initial approval (not a self-certification)
Saving an ID, checking a browser box, clicking Enable, or green CI is **not** bank ownership verification or G6 go/no-go. The on-prem authorized operator must independently verify actual recipient ownership, approved receipt/slip retention/backup and actual G4/G6 #81 gates, set the API QR and slip flags through a separately authorized release, and then approve the **exact disabled store receiver revision** using protected G6 access:

```bash
sudo env RCAT_POS_PAYMENT_G6_GO_NOGO=approved \
  RCAT_POS_PAYMENT_APPROVAL_REF=SIGNED_PRIVATE_REFERENCE \
  bash scripts/ops/g6-receiver-approval.sh approve TENANT_UUID STORE_UUID REVISION --apply
```

On payment/security incident the authorized operator must revoke the exact receiver revision, including when it is paused:

```bash
sudo env RCAT_POS_PAYMENT_APPROVAL_REF=PRIVATE_INCIDENT_REFERENCE \
  bash scripts/ops/g6-receiver-approval.sh revoke TENANT_UUID STORE_UUID REVISION --apply
```

The new script only marks approval or revokes it. It does not enable Payment, verify banks, change flags, install services, deploy, or grant production authorization. Keep the original operator G5 emergency disable available; its revision increment also invalidates the web approval. No public merchant self-approval path, and no receiver identifier or protected approval reference enters the browser or normal runtime logs.

## Security and regression expectations
- SQL enforces authenticated scoped owner/manager, exact tenant/store, expected revision CAS, independent DBA approval tied to receiver revision, release-ready flag for enabling, mask-only response, audit and no runtime table grants.
- API enforces Google session, allowed Origin, CSRF, strict request keys/types and runtime QR/slip flags. No finance-write flag is required for basic manual QR+slip.
- Disabling remains possible even after global flags are turned off. A stale client cannot override an operator emergency stop.
- No client-side paid inference. Manual receipt confirmation still requires checking external bank transactions.
- CI: existing PostgreSQL integration runner adds `tests/db/g6-receiver-activation.sql`; frontend/API checks via existing affected CI. Real RCAT IOT host, actual PromptPay account ownership, pilot, restore/retention and Production remain **BLOCKED pending explicit #81 approval**.

## Rollout/compatibility
- Migration `051_g6_approved_receiver_activation.sql` is additive and preserves old disabled state. `approved_revision` is NULL by default. An already operator-enabled legacy receiver remains enabled, but will not gain browser reactivation privilege by migration.
- Existing operator G5 scripts retain their privileges. A G5 operator disable increments the revision and invalidates any prior G6 approval.
- If code deploys with flags off, the web button remains unavailable; no funds are exposed.
