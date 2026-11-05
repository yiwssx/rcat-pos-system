# G2 — Product WebP Media and Printable Table QR (#38, PR #66)

**Boundary:** Hardware-free RCAT POS Ordering; no payment request, PromptPay QR,
real-money settlement or Production deployment.

## 1. Printable table QR is a PUBLIC locator, never an ordering credential

- The Merchant owner/manager opens **พิมพ์ QR โต๊ะและออกรหัสรอบโต๊ะ**,
  creates/chooses a table and prints the A5 sign.
- The QR is an actual encoded SVG QR matrix for the configured HTTPS Customer
  `/order` URL. Its query contains only `tenant`, `store`, `table`
  public UUIDs; it contains **no session, login, code, payment reference
  or visit bearer**.
- Scanning QR opens a code-entry page with NO product/checkout permission.
  A manager/owner separately presses **ออกรหัสโต๊ะใหม่**, confirms rotation
  and communicates the eight-digit code to customers of that active table.
- The server requires `GUEST_TABLE_CODE_PEPPER` (64 lowercase hex characters,
  generated using `openssl rand -hex 32`). It HMAC-SHA256 binds the code to
  tenant/store/table; only the digest is stored. **Keep the pepper identical
  across API replicas**, secret from logs and never expose it to the browser.
- Guest `POST /api/guest/ordering-code/redeem` validates eight digits, tenant,
  store and table. A PostgreSQL `FOR UPDATE` lock and **12 invalid tries per
  ten-minute window per active table** prevent high-speed guessing even across
  API replicas. Failures are recorded using normal transaction results, not
  raised exceptions that would roll back the failed counter.
- A valid redemption receives a **separate, random 256-bit guest visit
  token**; it is returned only in the HTTPS response and kept in page
  memory. Two guests never receive a shared bearer. The static QR URL is
  unchanged and is not promoted to a credential.
- A staff code rotation revokes the parent visit and therefore ALL previous
  guest grants automatically, without deleting Orders already committed.
  Issuing a new code resets the cap for the new visit. Up to 200 distinct
  guest grants are allowed per visit to bound server-side storage.
- The original high-entropy dynamic QR/visit code path is preserved for
  backward compatibility and remains independent from the printable QR.
- The code **is not proof of physical proximity**: someone who learns a
  valid code can share it. Operational controls are staff distribution,
  short visit lifetime, code rotation on customer turnover, revocation and
  per-table attempted-guess limits. Rotating a code does not revoke an
  already submitted Order tracking token.
- Known limitation: shared invalid attempts may temporarily lock out a
  legitimate guest; staff can rotate to a fresh code. Distributed edge
  abuse/WAF, physical-device testing and real TLS are Staging acceptance
  gates, not CI claims.

## 2. Product Media

- Merchant owner/manager can upload JPEG, PNG or WebP from a phone/desktop.
  Browser Canvas decodes, resizes and re-encodes to WebP (lossy, no source
  EXIF), and sends raw `image/webp` bytes with secure Session, Origin,
  CSRF and `X-Expected-Revision`. No base64 or arbitrary file paths.
- API's separate raw body parser caps WebP requests at **192 KiB** while
  leaving JSON limits unchanged. Server rejects RIFF mismatches,
  multi-chunk/polyglot/VP8X/metadata/animated/unknown signatures,
  dimensions outside 1–1600 and anything over 196608 bytes. Browser-side
  processing is **not** a security boundary.
- PostgreSQL `rcat.menu_product_media` has exactly one current image per
  product, tenant/store/product foreign keys, digest, immutable bytes during
  delivery and FORCE ROW LEVEL SECURITY. Only narrow authenticated
  SECURITY DEFINER operations may mutate. Image updates/deletion increment
  the product revision and append audit records (no raw bytes in audit).
- A public UUID-addressed image route only returns pictures when the product
  is **active and unarchived**. Archived/sold-out products return HTTP 404
  publicly; staff-scoped read can still show a sold-out product photo.
  `Content-Type:image/webp`, `nosniff`, CSP, same-origin resource policy,
  no-store and digest ETag are set on binary responses.
- Image references are presentation-only in the public Guest menu and do
  not change product price, Order item snapshots, inventory or payment state.
- Current G2 media storage is **inside PostgreSQL**, ensuring it participates
  in the existing G4 `pg_dump` and isolated restore integrity tests, but
  may increase DB backup volume. An S3/R2-backed CDN, malware/image
  canonicalization worker, lifecycle/retention policy and large-scale
  storage limits require separate Staging/operations evaluation.

## 3. API contract

| Action | Route | Trust boundary |
| --- | --- | --- |
| List printable tables | `GET /api/tenants/:t/stores/:s/tables` | Staff session, tenant/store membership |
| Print QR SVG | `GET /api/tenants/:t/stores/:s/tables/:id/print-qr.svg` | Staff session, scoped active table, no-store |
| Issue new code | `POST /api/tenants/:t/stores/:s/tables/:id/issue-code` | Owner/Manager, Origin + CSRF; reveals code **once** |
| Redeem code | `POST /api/guest/ordering-code/redeem` | Public Origin, HMAC code, persistent DB attempt cap; returns new bearer |
| Resolve token | `POST /api/guest/ordering-visit/resolve` | Existing high-entropy token OR independently granted client token |
| Put media | `PUT /api/tenants/:t/stores/:s/catalog/products/:id/image` | Owner/Manager, raw WebP, CSRF, exact product revision |
| Remove media | `DELETE /api/tenants/:t/stores/:s/catalog/products/:id/image` | Owner/Manager, CSRF, exact revision |
| Staff image | `GET /api/tenants/:t/stores/:s/catalog/products/:id/image` | Verified staff membership, including sold-out |
| Guest image | `GET /api/guest/catalog-media/:t/:s/:id` | Public only if current product is available and not archived |

## 4. Release tests and remaining dependencies

CI must validate checked migrations 027–028, SQL role isolation,
12-attempt code lock, per-client grant, cross-tenant denial, rotation and
immutable existing Orders; bounded WebP format rejection and active-only
delivery; real Chromium mobile browse/print/code flow and upload/conversion,
plus original HTTPS/CSRF/SSE/Backup-Restore E2E.

**Before Staging signoff:** configure live OAuth and TLS, safe secret
distribution/rotation, scan real printed QR with physical phones, test public
code forwarding/lockout handling, scope external rate controls, evaluate
PostgreSQL image/backup growth and establish offsite backup plus on-call
recovery. **No production or real payments until G5/G6 gates.**
