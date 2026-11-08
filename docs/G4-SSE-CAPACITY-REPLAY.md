# G4 — Durable SSE Capacity, Replay & Session Revocation

**Status:** CI-only qualification. This does NOT establish multi-instance
capacity, infrastructure/proxy SSE support, or a Production SLO. Related:
#8 (Merchant Operations), #10 (Security/Recovery), #13 (master tracker).

## Architecture under test

The existing NestJS Merchant SSE stream has a per-instance cap of **32
long-lived connections**. Each stream polls the tenant/store-scoped
PostgreSQL Outbox every three seconds, pages at most 50 events, and releases
its database connection after each query. A client-side `Last-Event-ID`
is advisory and MUST NOT override the durable staff acknowledgement cursor.
Clients perform authoritative Order reconciliation before acknowledging
committed Outbox events. The stream is an advisory wake signal and never a
Payment or bank-verified event.

## Automated qualification

`tests/e2e/g4-sse-qualification.cjs` runs as part of the existing
`tests/e2e/g4-browser-http.cjs` scenario inside
`.github/workflows/g4-browser-http.yml`. Guest checkout and staff login use the real NestJS API behind the Angular
test-only HTTPS proxy. **The SSE capacity probe starts a fresh, second
NestJS instance on loopback port 31949**, sharing the same ephemeral
PostgreSQL 16 database. This eliminates legitimate streams remaining from
prior Merchant browser tabs when measuring the exact per-instance cap.
A staff logout through the first instance must revoke an SSE feed on the
second instance. The second instance is reached directly from a trusted CI
Node test client; it is not a public or browser HTTP endpoint.

| Invariant | Test |
| --- | --- |
| Anonymous / foreign tenant | Stream requests return 401 / 404, before any SSE response body is sent |
| Outbox backlog >50 | 35 extra independent real HTTP Orders after the prior E2E/HTTP run force two Outbox pages |
| Replay completeness | Parse at least 55 real SSE event frames, validate server IDs, Order references, increasing 64-bit cursors, and no tracking token or payment data |
| Durable acknowledgement | Acknowledge the 50th Outbox ID using real CSRF-protected HTTP endpoint |
| Forged Last-Event-ID | Reopen with header `9223372036854775807` and prove the first SSE event starts immediately after the persisted acknowledged cursor, **not** the forged value |
| Maximum connections | 32 simultaneously open SSE responses must succeed; the 33rd must receive HTTP 503 |
| Socket cleanup | Abort one stream and verify a replacement opens successfully, without restarting the API |
| Committed Order wake | Submit a new real HTTP Order and verify the remaining live SSE stream delivers its exact persisted event ID |
| Session revocation | Revoke the authenticated staff Session while SSE is connected; next poll emits `access-revoked`, and new stream authorization fails |

Each test has bounded HTTP deadlines, checks the exact response status and
persists no live credentials. Open streams are aborted in a `finally` block.
CI uses only existing test identities and the ephemeral HTTPS certificate;
it does **not** relax Secure/HttpOnly/CSRF requirements or persist bearer
tokens into URLs.

## Non-Payment release gaps

- Repeat against multiple NestJS workers / replicas with a reverse proxy,
  idle timeouts, L7 buffering configuration and full connection-limit metrics.
- Sustained multi-hour soak at measured peak concurrency, reconnection
  thundering-herd protection, backpressure/slow-reader and resource telemetry.
- Mobile physical screen-sleep/reconnect and actual device-browser matrix.
- Backup/restore, incident alerting, disaster recovery and security review.

G5 per-Order PromptPay is still LAST. No Production deployment, live Payment
QR, bank account, or public Merchant session is exercised here.

## Update: cross-process SSE consistency (8 Nov 2026)

The CI probe now also opens **both** an authenticated primary HTTPS
Merchant-proxied stream and an isolated second NestJS API stream at the
same time. A single newly committed Order must appear in both with the
same durable event ID. After an authoritative scoped Merchant Order
lookup, the primary HTTP endpoint acknowledges the event; the second
API's feed immediately observes the shared PostgreSQL acknowledgement.
This establishes **two-process event/cursor correctness in CI**, not a
sustained multi-replica capacity or physical Staging SLO.

A separate operator-only PostgreSQL retention preview is described in
[the G3 Outbox retention document](./G3-OUTBOX-RETENTION-PREVIEW.md). It
reports old events and recorded ack watermarks without deleting
unacknowledged data or granting runtime SQL access. Production retention
policy and maintenance scheduling remain open.
