# Delivery roadmap and release gates

| Stage | Outcome | GitHub issues | Done when |
|---|---|---|---|
| G0 Discovery | Validated requirements, diagrams, threat model | #1 | UX and scope reviewed |
| G1 Foundation | Angular/NestJS workspace, CI, tenants/auth | #2 #3 | Fresh install + isolation tests pass |
| G2 Commerce | Catalog/QR, storefront, order/bill core | #4 #5 #6 | End-to-end fake payment ordering works |
| G3 Payments/Operations | Verified payment, realtime merchant PWA | #7 #8 | Replays, retries, reconnect tests pass |
| G4 Pilot readiness | Reports, security, backup, deployment | #9 #10 #11 | Recovery and pilot go/no-go passed |
| G5 Optional expansion | Delivery, accounting, subscription etc. | #12 | Prioritized by pilot evidence |

**No dates committed yet:** time estimates require team capacity, domain decisions and scope validation.

## Critical dependencies
- Never begin live payment integration before merchant identity and the bill/payment state model are reviewed.
- Begin threat modelling with G0; security quality gates apply throughout.
- Document which tests can be affected-only and which must run globally (schema/migrations, auth/tenant, payments, security).

## Change control
Each issue owns acceptance criteria, tests, docs, risk and rollout notes. Link PRs to issues. Merge after checks/review; do not auto-close work solely due to a green build.

