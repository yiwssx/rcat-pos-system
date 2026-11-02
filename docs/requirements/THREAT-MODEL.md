# RCAT POS — Initial threat model (G0)

Status: initial baseline; refine during #3, #6, #7 and #10 before any live merchant/guest traffic.

## Trust boundaries
- Public guest browser vs guest table session/order QR token.
- Merchant/staff authenticated browser vs tenant-scoped NestJS endpoints.
- Platform admin vs individual merchant data and audit.
- API vs PostgreSQL/Object Storage/notification queue.
- **Future** bank/payment provider webhook vs public internet (G5 only).

## High-risk scenarios and controls
| Threat | Security requirement | Proof |
|---|---|---|
| Cross-tenant ID enumeration | Authenticate and scope every query and mutation on server; avoid trusting caller tenant ID | Negative integration tests for tenant A requesting B data |
| Stolen/stale table QR | Revocable/expiring table guest session and rate limits; don't expose old order history | Invalidated QR rejected |
| Forged Order totals | Snapshot server-priced items and modifiers in transaction | Tampered client amount ignored |
| Duplicate Order retry | Idempotency key + atomic DB write and payload fingerprint | Concurrent double-submit creates one Order |
| Lost notifications | DB outbox, durable unacknowledged queue, explicit replay | Reconnect retrieves all missing Orders |
| Staff privilege escalation | Role-scoped permissions, session revocation and audit | Unauthorized staff action rejected |
| Payment spoofing (G5) | Verify webhook signatures and provider transaction data, never trust screenshot | Replay/spoof/amount mismatch tests |
| Payment merchant misrouting (G5) | Merchant receiver ownership and amount/Order mapping | Wrong receiver or amount rejected |
| Abuse of public QR API | Rate limit, CSRF/cookie considerations, anti-bot where justified | Abuse test without blocking normal guest ordering |
| Data leakage | Minimize logs, secrets in managed stores, retention, backup encryption | Redaction tests and controlled restore |

## Release gates
- G2/G3: core Order and tenant isolation tests, authorization, audit and concurrency.
- G4: backup restore, monitoring, app security review, incident procedures.
- G5: bank provider onboarding and financial transaction threat model, webhooks and refunds.
- G6: controlled pilot with tested payment reconciliation; no public real-money launch beforehand.

## Open product decisions
- Merchant roles/permission matrix by business type.
- Pay-first versus pay-later policy for live stores (can be added in G5; G2/G3 use order-first demos).
- QR session rotation mechanics for printed table codes versus per-visit tokens.
- Payment provider merchant onboarding, transaction reference support, account verification and Thai regulatory review.
