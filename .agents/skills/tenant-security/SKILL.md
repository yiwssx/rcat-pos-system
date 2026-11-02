---
name: tenant-security
description: Use for SaaS tenant isolation, authentication, sessions, RBAC, QR security, audit logs or access reviews.
---
# Multi-Tenant Security — RCAT POS

- Threat-model merchant/admin/guest privileges, stale table QR, cross-tenant IDs and payment reference leakage.
- Identify current tenant/store from authenticated server context, not arbitrary client-submitted IDs.
- Enforce tenant scoping in API and data layers; use DB policies/RLS when appropriate and carefully tested.
- Define role-and-scope matrix; least privilege for cashier, kitchen, owner and platform staff.
- Use secure HttpOnly cookies and explicit CSRF/CORS/session controls; login rate limiting and session revocation.
- QR guest token must be unguessable, scoped, rate limited and revocable; avoid exposing private tables or order history.
- Store audit events for critical admin, refund, price, staff or payment actions; never write secrets to logs.
- Run negative tests: cross-tenant read/write, privilege escalation, expired token, replay and ID enumeration.
- Treat privacy and retention requirements as a prerequisite to public launch.

