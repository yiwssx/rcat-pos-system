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

## Remaining dependency order

1. **B2 — QR capabilities:** a permanent independently revocable Store QR identifier, separate from Table QR; mode-specific server route/gates; fresh independent customer grants bound to the same device/session, never Store-QR-global Order access; scoped abuse budgets.
2. **B3 — Bills:** active Bill per Table with a uniqueness constraint and row/advisory locking; only authenticated Merchant closes a Bill; closure atomically revokes its Guest grants and deactivates the old visit before the next Bill may accept orders. **Do not** create a Bill merely by scanning.
3. **C — Quick add-ons:** owner-bound Order append with transaction-idempotent item and price snapshot updates, independent merchant `accepted` and `preparing` cutoff; explicit `เริ่มเตรียม` action determines the freeze, never acceptance. Coordinate merchant transition and guest appends with one Order lock.
4. **D — UX:** Merchant Table/Quick/Hybrid channel controls and QR print, independent Guest collection/table context and appropriate expiry/closed messages; no false Payment success. Retain official Spartan Helm.
5. **E/F — acceptance:** test multi-phone same table aggregation, two strangers same Store QR isolation, old-page Bill revocation, concurrent close/scan/order, same-device append/Preparing race, changed idempotency payload and cross-tenant permission denial; real Owner Local Demo visual/physical QR acceptance.

**Release separation:** B1 SQL CI is not B2–F completion; #81 on-host staging and #82 protected offsite policy are separate, G5 #7 Payment remains last and per-Order. No new infrastructure, service, workflow file or live host action for this stage.
