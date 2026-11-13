# RCAT POS — UX Redesign Execution Plan

Status: UX-01/UX-02/UX-03 implementation is proposed in PR #95, based on merged single-entry portal PR #93. This is source-level completion only; rendered browser review and current-head CI remain acceptance gates.

## Boundaries

- One portal and same-origin role-aware routes. Do not recreate three websites, role pickers or alternate domains.
- Existing #8 Merchant and #5 Guest scopes; no new payment, host, DNS, Production or bank change.
- Preserve server-enforced tenant permissions, Order states, QR safety, stock rules and existing URLs. UI affordances are not authorization.
- Reuse commit-bound CI evidence and do not rerun existing database tests on RCAT IOT.

## Slices and acceptance

| Slice | Scope | Exit criterion |
| --- | --- | --- |
| UX-01 | App shell and navigation | Current route highlighted; grouped tasks; store context; 320px mobile nav; role-filtered links; no privilege leakage |
| UX-02 | Semantic Design System V1 | CSS token source and deliberate Thai-first orange identity; common spacing, focus, surface/foreground |
| UX-03 | Merchant start page | Compact task-oriented workspace; primary daily Order action; owner shortcuts; informative no-store and retry states |
| UX-04 | Guest menu, modifiers and cart | 320–430px one-handed flow; table identity; option sheet; visible cart; no invalid price/success claims |
| UX-05 | Catalog, QR, Inventory, Reports and Owner tools | Focused pages, progressive disclosure, coherent forms/navigation and status hierarchy |
| UX-06 | Visual/UX evidence | Mobile/tablet/desktop snapshots, keyboard/200% zoom, auth/accessibility/error/reconnect verification |

## Known adverse paths to preserve

Guest: expired/revoked QR, invalid table code, unavailable product, new price, stale cart, offline, duplicate submit, order cancelled. Merchant: no store, wrong role, foreign tenant route, 401 expiry, reconnect, insufficient stock, duplicate action and interrupted form.

## Loop and proof

1. Inspect actual PR/Issue/CI before work, use the latest merge base and do not repeat closed tasks.
2. Use focused PR with code diff and links to original issues. Run existing affected frontend/typecheck/build and relevant E2E only.
3. Record source SHA plus CI results. Code CI alone does not establish rendered visual acceptance.
4. Keep G4 host staging #81/#82 and G5 real payments #7 independent.
5. Stop when delta is evidenced; do not add recursive test or infrastructure work just to claim completion.

No fake tenant-wide Platform Admin should be presented by the existing tenant-owner settings area.
