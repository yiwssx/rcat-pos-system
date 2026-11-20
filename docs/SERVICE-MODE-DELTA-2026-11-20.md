# G2/G3 Service Mode — implementation delta and safety contract (20 Nov 2026)

**Source of truth:** [Issue #102](https://github.com/yiwssx/rcat-pos-system/issues/102), owner-approved 16 November 2026 requirements Q1–Q10. This document distinguishes existing behavior from the desired new domain model; it does **not** authorize Production or G5 Payment.

## Existing behavior and exact gaps

| Boundary | Reusable existing code | Gap before Quick/Table/Hybrid can be enabled |
| --- | --- | --- |
| Store settings | `rcat.stores.ordering_enabled`, `set_store_ordering_enabled` (migration 034), Merchant open/close ordering | No Store QR vs Table QR channel configuration or true Hybrid |
| Printed Table QR | `store_tables`, `table_ordering_visits`, `table_guest_grants`, `open_printed_ordering_table` (009/027/034), per-device capability | This is a **table** credential; Store QR cannot safely share its table visit or cart between strangers |
| Guest Orders | `place_guest_order_when_open`, server-authoritative satang snapshots, per-visit idempotency (011/035/041) | No customer-owned, pre-Preparing **append** transaction with atomic cutoff |
| Merchant preparation | `transition_merchant_order`, independent `submitted→accepted→preparing→served` (012) | Existing explicit Preparing transition is reusable; must coordinate races with new append writes |
| Bill grouping | `rcat.bills`, one `visit_id` per Bill, `create_operational_bill`, immutable Order aggregation (014/041) | No active/closed Bill lifecycle, no ability to associate future visits with the same printed Table QR safely after closure |
| Guest credentials | Printed QR is public; grant is per-device, time-bounded; Order tracking bearer is separate (013/027/034) | Normal expiry versus **Bill-closed revocation** must be distinguished; stale pages must never automatically regain authority over the next Bill |
| Payment | G5 #7 per-Order payment obligation; no Bill payment authorization | **Do not** convert operational Bill totals into confirmed receipts or Bill payment |

## Stage B1 delivered by migration 043

A private, tenant-and-store-keyed **dormant** preference is added with `table | quick | hybrid`, default **table** when no row exists. Owner/Manager can change it only through a SECURITY DEFINER function with authenticated membership, a store row lock, revision compare-and-swap and an exactly-once audit per changed value. `rcat_auth` and `rcat_app` have **no direct read/write access** to the private preference. Test `tests/db/service-modes.sql` covers tenant separation, lower staff roles, invalid options, duplicate/no-op requests, stale revisions and audit. Existing store behavior is unchanged.

**Critical admission rule:** B1 does **not** switch Guest QR routes or unlock Quick Service. No new API/UI exposes this setting to customers or merchants until B2–E enforce the entire selected mode server-side. The existing `ordering_enabled` open/close switch remains in force.

## Stage B2 — permanent Store QR and isolated per-customer grants

**Implementing source:** `db/migrations/044_store_qr_guest_sessions.sql`, `StoreQrController/StoreQrService`, isolated SQL and HTTP regressions. This is **QR/session admission only**, not a Store QR checkout release.

- Printed Store QR URL contains `tenant`, `store` and an unguessable **public locator** `counter` only. It is separate from Table QR and does not contain a Guest bearer or reusable session.
- Owner/Manager explicitly generates or rotates the public Store QR; cashier may view/print it but not rotate. The public identifier is stable until explicit rotation. Rotation atomically rejects the old QR and revokes all associated Guest sessions. This does not rotate Table QR codes.
- A Guest can open a Store QR only when the owner-selected service mode is `quick` or `hybrid` and store ordering is enabled. Each individual scan mints a **fresh, cryptographically random 256-bit private token** whose digest alone is persisted. Tokens are bound to tenant, store, QR generation and service-mode revision; the printed public QR cannot read any Guest session or Order.
- Guest possession token is sent via POST body and returned solely in a `Cache-Control: no-store` response, **never placed into printed URL, browser history, payment payload or analytics**. Use per-tab in-memory/session storage in the later Guest UI stage, not a shared Store QR session.
- The server revalidates scoped token, mode revision, QR generation, store intake and expiry on each resolve. Closing intake revokes old tokens even if the store is reopened; normal expiry cannot resurrect credentials.
- SQL scoped roles have **no direct reads or writes** of Store QR/session private tables. Existing PostgreSQL-shared Guest `redeem`/`resolve` rate budgets protect both public routes.
- Staff endpoints: `GET /api/tenants/:tenantId/stores/:storeId/service-mode`, CSRF-protected `POST .../service-mode` with CAS, `GET .../store-qr`, CSRF-protected `POST .../store-qr/rotate`, and `GET .../store-qr/print-qr.svg`. Guest endpoints: `POST /api/guest/ordering-store/open` with public IDs, `POST /api/guest/ordering-store/resolve` with private token.
- **Fail-closed:** these Store Guest tokens are intentionally **not accepted** by the existing Table Visit `resolve`, `review-cart` or `POST /api/guest/orders` paths. There is no fake shared table or synthetic Bill. Add Store-only catalog and correctly owner-scoped Quick Order placement in later C/D, after the server-side Order identity and concurrency invariants are established.

**Operational boundary:** The printed Store QR targets the `counter` query parameter but the Guest Angular route does not yet support it; therefore it is an **engineering QR admission increment**, not a Guest-ready end-to-end experience. Do not distribute Store QR to actual customers, activate Quick Service in a live store, imply paid status or deploy to Production from this PR. Existing Table QR flow must remain unchanged. DB tests explicitly cover two independent scan grants, rotation, closed/reopened shop, service-mode revision, cross-tenant roles and invalid attempt to reuse a Store QR token for Table Visit.

## Stage B3 — Table Bill lifecycle (operational, not settlement)

**Implementation:** migration `045_bill_lifecycle.sql`, authenticated Bill `POST .../bills/:billId/close`, existing Bill snapshot extended with `status`, `closedAt`, `closedBy` and `creationSource`. No Bill Payment or verified receipt is inferred.

- One **active operational Bill per (tenant, store, table)** is enforced with a PostgreSQL partial unique index. Existing historic Bills/Orders remain readable. Migration intentionally **halts** if a database has more than one legacy Bill for a table: Owner/operator must reconcile that ambiguous history before staging; no silent backfill, guessed payment confirmation or auto-closure.
- One Table Visit may receive Orders from several separately tokenized Guests; the **first successful public checkout** atomically creates its Bill while holding the same store transaction lock used by Checkout and close. A scan alone never creates a Bill. Staff's prior `create_operational_bill` remains idempotent for legacy/tests, but cannot create another open Bill for a new visit.
- Staff closure is authenticated and CSRF/Origin guarded. Owner/Manager/Cashier may close; Kitchen/foreign tenant cannot. A close is **idempotent by immutable Bill ID** and emits one audit record. It never sets `paid`, `payment_verified`, refunds or modifies individual Order amounts/items.
- Closure marks the Bill closed, revokes its Table Visit and explicitly marks all associated Guest grants revoked in the **same SQL transaction**. A stale browser token (including an old retry/cart) cannot mutate the new table cycle; Order-only tracking remains independent.
- The **same permanently printed Table QR** can be intentionally scanned again after closure: the existing public scan endpoint mints a **new Visit and Guest grant**; a new Bill opens only on the first successful Order. Staff rotate/code issuance or auto-visit renewal cannot bypass an active Bill (HTTP 409 `BILL_CLOSURE_REQUIRED`).
- Lock order: public checkout uses store `FOR UPDATE`, then Table/Visit checks, then Order/Bill; Merchant close uses store then Table then Bill/Visit/grants. A partial unique index protects cross-instance races as a second invariant. No extra database service or workflow runner is introduced.
- PostgreSQL `tests/db/bill-lifecycle.sql` and updated original Bill fixture validate two phones in one Bill, independent Orders, closure/replay/audit, stale-grant failure, unchanged Order status/payment, and next QR cycle. The existing HTTP smoke verifies CSRF, permissions, close and rescan.

**Known follow-up:** There is no Merchant close button or fully interactive Bill management screen until D, and Guest UI handling of B2 Store QR still depends on C/D. Bills are *operational* groupings; G5 #7 payable obligation remains **per Order**. This stage MUST NOT auto-close a Bill on a customer assertion, slip or unverified QR payment, and cannot be considered Owner/Host accepted from CI alone.

## Remaining dependency order

1. **B2 — QR capabilities (server admission delivered, Owner/UI UAT pending):** public Store QR route and independent per-scan grants implemented. Guest UI possession and Store-scoped browsing/ordering are deferred to C/D; do not treat B2 as end-user deployment.
2. **B3 — Bills (server lifecycle implemented, Owner/UI UAT pending):** first real Order opens one active Bill per Table, Merchant close revokes old grants; a fresh scan starts a new Visit. Owner-facing close UI is stage D; CI does not prove host acceptance.
3. **C — Quick add-ons:** owner-bound Order append with transaction-idempotent item and price snapshot updates, independent merchant `accepted` and `preparing` cutoff; explicit `เริ่มเตรียม` action determines the freeze, never acceptance. Coordinate merchant transition and guest appends with one Order lock.
4. **D — UX:** Merchant Table/Quick/Hybrid channel controls and QR print, independent Guest collection/table context and appropriate expiry/closed messages; no false Payment success. Retain official Spartan Helm.
5. **E/F — acceptance:** test multi-phone same table aggregation, two strangers same Store QR isolation, old-page Bill revocation, concurrent close/scan/order, same-device append/Preparing race, changed idempotency payload and cross-tenant permission denial; real Owner Local Demo visual/physical QR acceptance.

**Release separation:** B1 SQL CI is not B2–F completion; #81 on-host staging and #82 protected offsite policy are separate, G5 #7 Payment remains last and per-Order. No new infrastructure, service, workflow file or live host action for this stage.
