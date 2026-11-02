# RCAT POS System

Hardware-free, mobile-first, multi-merchant POS and QR ordering platform.

> **Status:** Planning and repository foundation. Not production-ready.

## Product goals
- Merchants open and manage stores from a browser, phone, tablet, or computer.
- Customers scan a table/store QR code to browse, order, pay, and follow order status.
- No dedicated POS terminal or printer is required.
- Cash/manual-verification and provider-verified digital payments are distinct flows.
- Stores must be strictly isolated in the multi-tenant backend.

## Proposed architecture
- Customer web, Merchant PWA and Platform Admin: Angular + TypeScript
- API: NestJS (HTTP adapter selected by compatibility and measurements)
- Data: PostgreSQL; queue/cache only when justified
- Workspace: pnpm + Nx (implementation milestone)
- Infrastructure: containerized cloud deployment, HTTPS, backups and monitoring

## Current stage
Planning and infrastructure governance only. See the project's GitHub Issues for the implementation tracker, and `docs/` for approved architecture decisions after the foundation pull request is merged.

No app, payments, database schema, or production deployment exists yet.
