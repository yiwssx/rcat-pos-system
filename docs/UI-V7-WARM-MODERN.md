# RCAT POS V7 — Warm Modern

Owner approved on 20 Nov 2026 under #102. Warm Modern supersedes Fresh Botanical and monochrome iOS styling for visual identity only. Use iOS interaction clarity, not imitation. Density: balanced. Orange: brand accent only.

## Canonical visual tokens

One Spartan semantic theme: cream canvas #FFF5E9, ivory surface #FFFDFA, espresso text #382921, muted #765B4C, deep teal action #186B60, mint selection #DDF2E9, terracotta brand #C04C2B, peach brand surface #FCE0CB, border #E9D7C4. Status colors: incoming blue, accepted violet, preparing amber, served mint, cancelled destructive. Always accompany state color with readable text. Order and Payment remain separate.

Use existing self-hosted IBM Plex Sans Thai, official Spartan Brain/Helm, semantic Tailwind utilities, 44px touch targets and 16px body / 14px supporting text where practical. Preserve actual RCAT POS logo. No new framework, dependency, CSS override stack or decorative gradient sidebar.

## Approved desktop/mobile target

- Customer: compact branded store header; category/search rail; 2-column mobile menu, adaptive desktop catalog with sticky cart summary; existing product customization and checkout sheets keep server-authoritative prices and required order context; tracking remains independent of payment.
- Merchant: shared role-aware shell; compact colored order queue filters, readable order card, explicit accept/prepare/serve actions, item notes and customer/delivery context; adaptive list/grid; collapse secondary management content. Mobile frequent-task navigation reuses existing permitted routes and opens the existing full navigation sheet for secondary tasks.
- Admin: account summary derived only from loaded authorized data, responsive searchable account list and compact account form; role and store assignment remain scoped; no new permissions or fake metrics.
- Catalog, tables/QR, stocktake and reports already use semantic components; review their rendered density and interaction. Inventory, tenant owner/staff settings and guest tracking migrated in the second slice. Payment-specific behavior and standalone payment administration are out of scope. Replace obsolete feature CSS only when its consumers are migrated.

## Delivery and evidence

Initial engineering slice: theme, shared shell/login, guest catalog/cart sheets, Merchant order board and Platform access console. Second slice: inventory, tenant owner/staff and guest tracking now use shared semantic components; retired their unused legacy CSS. Visual review of the first runtime capture identified overly dark field fills and expanded secondary inventory tools. Use ivory fields with semantic input borders and native task disclosures. Browser capture reuses the authorized tenant-owner fixture on desktop/mobile; Platform Admin owner acceptance remains separate. Implementation does not imply owner runtime visual acceptance. Preserve existing actions, API requests, session/authorization, order and payment gate semantics. Existing one-origin portal stays canonical. No change to backend, API, migrations, Auth/RBAC, Payment behavior, infrastructure, Backup or live flags.

Use existing affected CI and browser checks; update only assertions tied to superseded visuals. Capture actual Desktop/Mobile screenshots from approved build, not concept drawings. No duplicate Local Demo UAT, no new workflows/issues. Owner visual acceptance is distinct from CI; no auto-deploy. Record pending scope/evidence under #102, not fake checks.
