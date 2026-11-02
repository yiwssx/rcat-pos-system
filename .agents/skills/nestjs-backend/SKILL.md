---
name: nestjs-backend
description: Use when designing NestJS domain modules, APIs, data access, validation and event processing for RCAT POS.
---
# NestJS Backend — RCAT POS

Before work, read docs/ARCHITECTURE.md and docs/DECISIONS.md.
- Implement a modular monolith: identity/tenants, catalog, sessions, orders, bills, payments, audit and notifications.
- HTTP controllers validate DTOs, authenticate/authorize, and delegate to domain services. Do not place business logic in controllers.
- Use PostgreSQL transactions and database constraints for atomic order/bill/payment changes.
- Guard every merchant-owned action with tenant/store-scoped authorization and auditable identity.
- Public APIs never trust user-provided shop IDs, monetary totals or paid status.
- Implement idempotency on order submission and payment orchestration before exposing endpoint.
- Define explicit state transitions, concurrency policy, retries and an outbox/recovery strategy.
- Write contract and integration tests for success, race, invalid state and forbidden cross-tenant access.
- Choose Express/Fastify/Node HTTP adapter on compatibility and evidence, not preference.

