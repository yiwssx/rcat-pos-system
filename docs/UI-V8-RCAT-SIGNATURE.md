# V8 — RCAT Signature · Clarity First (#102)

> Historical visual direction superseded by [Modern Pastel SaaS Hybrid](UI-MODERN-PASTEL-SAAS.md). Preserve the contrast/reflow evidence and requirements; the orange palette is not the target.

Owner rejected V7 visual acceptance and approved V8 before implementation. Canonical unified portal remains Angular/Spartan/Helm/Tailwind; no business logic, Auth/RBAC, Payment, API, DB, infrastructure, backup or release-gate changes.

- Canvas #FAF6EE, surface #FFFFFF, primary #923617, primary hover #74280F, accent #FCE8DA, all light surface text #000000 / supplementary #333333, dark actions #FFFFFF. Status text black, semantic markers blue/violet/amber/green/red. Disabled text remains readable on opaque neutral backgrounds. No gradient behind necessary text, no opacity-dimmed labels.
- Contrast required >=7:1 for necessary text including fields and actions; essential control boundaries/icons >=3:1. Computed foreground/background and geometry, not token declarations alone. No clipping or document overflow, including 320/390/768/1024/1366/1920 CSS px; resize text 200%; intentional local table scrolling only where necessary. Target 44px interactive controls; do not hide overflow to make tests green.
- Customer: adaptive catalog and cart, responsive product/checkout sheets and tracking. Merchant: white order cards, slim status marks, compact queue, existing disclosures and business workflow. Admin: legible responsive account rows, compact editor and collapsed secondary tasks. Preserve official logo and Thai font.
- Remove unused canonical portal legacy CSS. Keep printed QR print stylesheet and payment-specific business logic unchanged. Test source is existing CI-only fixture, never real data or credentials. Platform Admin visual fixture may be mocked for GET presentation only; it does not establish real auth or permissions.
- Do not merge/deploy based on token changes or build alone. Record measured computed contrast/overflow, affected CI, screenshots and any unmeasured interactive states. Owner's final domain acceptance remains separate. V7 acceptance rejected, not reset to passed.
