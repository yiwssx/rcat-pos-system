# RCAT POS — development tracker

GitHub is the source of truth. Master tracker: https://github.com/yiwssx/rcat-pos-system/issues/13

**Decision:** Payment implementation (#7) is the final functional milestone, with **PromptPay QR/payment request for each Order**. Real-money production launch takes place **after** payment verification and release testing, not before.

## Execution order
| Stage | Issue | Area | Priority | State |
|---|---|---|---|---|
| G0 | #1 | Product scope and per-Order QR payment requirements | P0 | Open |
| G1 | #2 | Nx/pnpm Angular/NestJS foundation | P0 | Closed |
| G1 | #3 | Multi-tenant auth/data | P0 | Open |
| G2 | #4 | Catalog, tables, ordering QR session (G2 follow-up #38 remains open) | P0 | Closed |
| G2 | #6 | Orders, prices and Bills (payment-ready schema only) | P0 | Open |
| G2 | #5 | Guest ordering and Order tracking UI | P0 | Open |
| G3 | #8 | Merchant PWA/realtime (no Payment dependency) | P0 | Open |
| G3 | #9 | Basic operational reporting/stock (financial reports later) | P1 | Open |
| G4 | #10 | Ordering security and reliability (continues across release) | P0 | Open |
| G4 | #11 | Staging/hosting infrastructure preparation (not production release) | P1 | Open |
| **G5** | **#7** | **Final business feature: per-Order PromptPay QR, verification, reconciliation** | **P0 — Release blocker** | **Open** |
| G6 | #10 #11 | Integrated security/payment tests, pilot and Production go/no-go | P0/P1 | Open |
| G7 | #12 | Expansion modules (after pilot) | P2 | Open |

A high-priority issue can deliberately be scheduled late if it needs mature upstream requirements. No feature issue has been completed by this decision-only update.

## Delivery invariants
- Every Order has its own payable total and future PromptPay request; a table QR never doubles as the payment QR.
- A generic personal PromptPay QR with an amount does not prove payment or provide guaranteed unique transaction reference.
- No bank integration, live QR payment endpoint, payment credentials or false "paid" flags before G5.
- Issue state in GitHub is authoritative; document table is not a synced progress mirror.

## Proof of done
Linked PR, relevant tests pass, tenant/permission and transaction invariants verified, relevant docs and rollout updated; never close Payment or Production on the strength of docs-only checks.


## Current G4 On-prem and nonredundant verification — 9 Nov 2026
| Track | Issue | State | Evidence / blocker |
| --- | --- | --- | --- |
| A — Coding | [#80](https://github.com/yiwssx/rcat-pos-system/issues/80) | **Closed (code-only)** | PR #83/#84/#85 CI artifacts and code merged; not a host acceptance |
| Lean evidence/CI | [#86](https://github.com/yiwssx/rcat-pos-system/issues/86) | See GitHub issue | [Rules, impact gates and register](LEAN-EVIDENCE-DELIVERY.md) |
| B — Staging deployment | [#81](https://github.com/yiwssx/rcat-pos-system/issues/81) | **Open** | Real RCAT IOT/RMS host capacity, DNS/TLS/OAuth/backup/restore/QR not verified |
| C — Policies/Acceptance | [#82](https://github.com/yiwssx/rcat-pos-system/issues/82) | **Open (partial approval)** | Owner approved C1 manual stock-on-accept and C3 Guest/Order p95 + RPO/RTO. C2 Offsite/cadence/retention still pending; B signoff not obtained |

Never rerun complete Nx/Database/Browser CI on RCAT IOT. Use prior CI evidence only where tested SHA and environmental boundary match. [Evidence register](evidence-register.json) contains historical CI proof and explicit missing Staging gates. Build only unique reviewed Staging release tags. G5 PromptPay remains LAST; G6/Production not approved.


## Owner-approved G4 execution — 9 November 2026
- [x] **C1** Manual Merchant sold-out and atomic ingredient stock consumption on Merchant acceptance; no checkout reservation/automatic sold-out.
- [x] **C3 targets** Guest menu p95 <=2.5 s, Order submit p95 <=3 s, backup RPO <=24 h and isolated restore RTO <=4 h. **Not measured** on RCAT IOT.
- [ ] **C2** Offsite destination, backup cadence/retention and permission to enable maintenance jobs remain **unapproved**. `RCAT_POS_BACKUP_POLICY_APPROVED=no`, `RCAT_POS_GUEST_RETENTION_APPROVED=no`.
- [ ] **B1–B6 #81** Operator host staging/HTTPS/OAuth/deploy/recovery/physical validation not executed. See [operator packet](G4-B1-B6-OPERATOR-RUNBOOK.md), [owner policy JSON](g4-staging-owner-policy.json), and read-only [evidence gate](../scripts/ops/g4-staging-acceptance.mjs). G4 acceptance is blocked until actual host proof and C2.
- [ ] **G5/G6** Payment and Production remain unstarted/not approved. No full local CI repeats on IOT.

## G4 decision update — 13 November 2026

- [x] Owner authorized **Staging-only preparation/deploy subject to existing real B1–B6 safety gates** and selected a **12-hour encrypted offsite backup cadence** (00:00 and 12:00 Asia/Bangkok) with **14 daily / 4 weekly / 3 monthly backup snapshots retained**. Existing timer stays *uninstalled*. No Restic pruning or application-record deletion approved.
- [ ] **C2 activation remains BLOCKED** until a real pre-existing approved offsite storage destination, cost/storage-capacity review, protected credentials, repository verification and isolated restore proof exist. Current Cloudflare R2 is not enabled; do not turn it on merely to get a green check. `RCAT_POS_BACKUP_POLICY_APPROVED=no` remains mandatory.
- [ ] **B1–B6 Operational Acceptance remains BLOCKED** until HTTPS/OAuth, protected DB role/secrets, verified pre-migration backup, actual staging deployment/health, restore timing, and owner/host acceptance. No Production, Payment, DNS, public SSH or new Host executor approved.

## HDA-06 signed OCI preparation — 13 November 2026

- [x] Added manual-only trusted-`main` four-component GHCR OCI publisher in the existing On-prem workflow; source policy and PR CI govern its admission. No new workflow file, Runner, SSH, cloud account, protected secret or Production change.
- [ ] **Publication/Operational Acceptance PENDING**: no owner-triggered signed image candidate has run, no four actual published digests or consumer-side attestations have been independently verified, and no real RCAT IOT B1–B6 deployment is accepted. Never promote signed source configuration alone to G4 PASS.


## Active owner-directed full UI replacement + per-menu Additional — 18 Nov 2026

**Execution tracker:** [Unified UI/UX + Ordering Issue #102](https://github.com/yiwssx/rcat-pos-system/issues/102). This is an **in-progress implementation track**, not a claim that the complete rewrite or host release is done. Owner instruction supersedes earlier V6 decorative/color treatment: use **genuine Spartan UI Brain + generated Helm**, Apple/iOS-like neutral layouts, shared semantic tokens, clean Thai typography; **remove verified-obsolete legacy page CSS** instead of adding more local overrides. No separate issue/epic.

| Gate | Scope / acceptance evidence | State as of 18 Nov 2026 |
| --- | --- | --- |
| U0 | Existing Angular/Nx, pinned Spartan 1.9; enforce no new ad hoc CSS, record design direction | **DONE** — PR #131 / SHA `351e4a0ee11c` |
| U1 | **Create real official Spartan Helm** button/card/input/field/select/badge/dialog/sheet/separator components, check imports, license and pinned source | **DONE (source + CI)** — official CLI 1.9.0 generated 10 component groups under `libs/ui/src/spartan`; imports/build/typecheck pass in PR #132 |
| U2 | Replace Auth/Login + Application Shell + Sidebar: no old CSS, accessible mobile navigation, consistent touch targets, font loaded | **PARTIAL (code PASS)** — PR #135 restructures shared Spartan Shell/Desktop nav/Mobile Sheet and Google OAuth login; CI PASS, Local Demo phone/desktop and owner visual signoff pending |
| U3 | Merchant Catalog/Category/Product editor with Helm; separate product image/option editing; remove old catalog CSS after parity | **PARTIAL** — 28+ action buttons, text inputs/labels and native selects migrated to Helm; Additional editor controls/presets migrated, replaced CSS selectors removed; legacy Catalog layout CSS still remains |
| U4 | Orders board, SSE/outbox, fulfilment actions and state/error/loading UI; preserve stock-on-accept and payment independence | **OPEN** |
| U5 | Tables/QR, Inventory/Stocktake, Reports/Finance, Staff/Settings/Admin with feature-parity and minimal layout | **OPEN** |
| U6 | Guest menu, product customization sheet, cart, checkout, tracking; 320/390/768/1365px; retain QR and server-authoritative amounts | **PARTIAL** — PR #133 extracts an Angular Spartan Helm Badge/Label modifier component, replaces key Customer detail/cart/search actions with Helm Button/Input and removes obsolete selector blocks; Spartan Sheet product/cart migration in PR #134 passed Foundation, Workspace and G4 browser CI; remaining Guest shell/styles and Owner UAT still pending |
| U7 | Remove retired V1–V6 selectors, redundant style files/unused directive/decoration **only after exact route parity**; make remaining style imports theme + font where possible | **PARTIAL** — PRs #133 and #135 remove dead Guest/Portal shell styles, V6 ribbon/wave stylesheet, legacy RcatButtonDirective/rcat-btn bridge; remaining legacy staff home/feature CSS still owed |
| U8 | All affected Nx checks, protected browser/HTTP ordering, Local Demo screenshots and Owner UI UAT at mobile/desktop | **OPEN** |
| U9 | Explicitly authorized host staging/release and rollback evidence; never imply CI == live browser acceptance | **PENDING host gate #81** |

### Additional options per menu: implementation already exists; reuse it

Baseline evidence (not a new feature/database): `db/migrations/010_product_modifiers.sql` defines tenant/store/product-bound `menu_modifier_groups` and `menu_modifier_options` with FORCE RLS and integer satang deltas. Further `030_catalog_editor.sql` enables edits; Merchant Catalog exposes create/edit group, option add/edit, min/max, option availability; Guest product sheet shows radio/checkbox choices with prices; Order API validates and snapshots choices. Do **not** create replacement `product_option_*` tables, duplicate price engines or hard-code universal sweetness options.

- [x] **M0 Domain and server foundation exists** — group tied to individual product, min/max rules, per-option signed delta, tenant/store authorization, immutable priced Order snapshot (verify any new changes against these existing contracts).
- [x] **M1 Existing Merchant UI/API capabilities exist** — create/edit group, create/edit option, enable/disable, per-product grouping.
- [x] **M2 Guest choice controls exist** — single-selection radio if max=1, multi-selection checkbox if max>1, optional item note; prices calculated/validated by server.
- [x] **M3 Owner/Manager-friendly UX** — clear Thai labels, one-choice vs multi-choice helper, mandatory vs optional, per-menu configuration; **optional** editable starting examples only (e.g. sweetness: หวานน้อย / หวาน 100% / หวานมาก; topping +10 THB), never force global defaults or seed customer data.
- [ ] **M4 Official Helm component migration (partial: Merchant, Guest choices and official product/cart Sheets migrated in PR #134; official radio/checkbox integration and owner visual UAT pending)** — accessible product-specific group editor and customer customization dialog/sheet; remove legacy CSS as replaced.
- [ ] **M5 Browser UAT (G4 real Chromium sweetness/topping +10 THB selection, cancel/revert, estimated totals PASS; Owner live visual acceptance pending)** — one menu with a required 1-of-3 sweetness group + optional topping +10 THB, and another menu with no extras; pricing exact in satang, permissions, unavailable options and snapshots; preserve old paid/not-paid distinction.

**Permissions:** Product editor writes are authorized for an Owner/Manager of the corresponding Tenant + Store. Platform Admin cannot bypass tenant/store restrictions merely for convenience; separate delegated access must already be valid.

**Code evidence for first implementation slice:** Draft PR [#132](https://github.com/yiwssx/rcat-pos-system/pull/132) with real generated Spartan Helm sources and Merchant Catalog/Additional migration. **CI at source commit `cec3ba8365bf310af62d913d34a2c0036826aefc`**: Foundation, Nx Workspace, PostgreSQL tenant-isolation and G4 Browser/HTTP E2E **PASS**; Local Demo Packaging **PASS** as well, giving 5/5 applicable workflows at the source commit. This CI evidence validates the bounded code change, **not** complete iOS redesign or Owner browser visual acceptance.

**Guest Spartan implementation slice (#133):** Source commit `cdeff7080597d1a6854fcf18c57b907c0704150f` passed Foundation, Workspace Quality (including customer typecheck/build/lint) and the real G4 Browser/HTTP Ordering E2E. Test fixture uses *per-product* optional sweetness (0 THB) and toppings (+10 THB), checks Spartan controls, changing and clearing choices, estimates 125.00 ↔ 135.00, and preserves actual Order submission. **On-prem packaging was still running at the evidence check**, so do not label it PASS by inference. Previous unchanged infra packaging #132 is historical context, not fresh proof for this source SHA. Remaining native dialog and CSS in other screens are tracked, no production/host deploy claimed.

**Guest official Sheet continuation (#134, candidate):** Both native product/cart `<dialog>` surfaces replaced by official pinned `HlmSheet` + Portal/Content/Header/Title/Footer; accessibility and programmatic open/ESC-close/expiry cleanup are covered by existing G4 Browser E2E additions. Removed old dialog root/backdrop/animation CSS without adding feature overrides. **Code acceptance evidence:** substantive source SHA `5d7fa22cc0984a4f6da827577ed5419e8086c887` passed Foundation, Workspace Quality (including build, typecheck, lint and unit tests), and G4 Chromium/HTTP Ordering E2E with accessible Sheet title, visible surface, Escape dismissal, Additional and real Checkout. **On-prem Local Demo Packaging remained in progress during external Browser Runner installation**, so it is **NOT marked PASS** for this SHA; reuse only previously established packaging invariants from #132. Merge and Owner Visual UAT are independent gates. Domain, Order API, payment, QR and DB remain unchanged. Further Guest form/presentation CSS and other screens remain open.

**U2 Spartan Shell & Google Login — PR #135:** Extracted `PortalWorkspaceNavComponent` for Desktop and Mobile; genuine Spartan Helm Button/Badge/Separator/Native Select and Sheet, neutral off-white/white canvas, explicit touch targets, CSS-only removal of old header/sidebar rules. Original four-color Google G, `/api/auth/google/start`, server permission filtering, single-origin routes and 401/CSRF behavior retained. Deleted `pos-v6-decoration.css` from build, obsolete V1/V6 shell CSS and the last unused `RcatButtonDirective` bridge; removed the global `--accent` color override that had broken Spartan's neutral semantic theme. **CI code evidence SHA `7baea04709dbb381f1d689be77593f69c2a57bb2`: Foundation, Workspace (Build/Typecheck/Lint/Test), G4 Chromium/HTTP Ordering all PASS.** Local Demo staging browser/packaging was *in progress* after correcting a CDK accessibility-tree test locator; not claimed as PASS or owner visual UAT. No host/Production deploy. **Still OPEN:** staff home old V6 cards/presentation, remainder of Feature CSS, responsive Owner screenshots and actual RCAT IOT host gate.

**Safety boundary:** keep existing NestJS API, migrations and RBAC unchanged unless a genuine capability gap is demonstrated, with scoped regression tests. Do not invent a new payment milestone. Only mark gates complete after matching GitHub SHA/CI and real Owner acceptance. No automatic Production deployment.
