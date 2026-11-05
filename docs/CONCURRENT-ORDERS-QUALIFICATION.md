# G4 Concurrent Orders & Inventory Contention Qualification

> Scope: **real parallel PostgreSQL transactions in an isolated CI database**, not a production-traffic benchmark. No live customers, no physical payment QR, no bank integration, and no Production deployment. Related: #10, #6, #9, #13.

## Why this exists

Sequential PostgreSQL assertions cannot establish that separate database sessions
remain safe when multiple guests submit at once and multiple devices accept,
cancel or review stock returns. The test harness opens a **separate transaction
for each operation** over a bounded connection pool. It runs after the
existing one-request SQL and HTTP security regressions.

**Source of truth:** `scripts/load/concurrent-orders.mjs`.

### CI assertions

| Scenario | Concurrent calls | Exact invariant |
| --- | ---: | --- |
| Guest double-click / retry, same visit+key+cart | 24 | One Order and one outbox `submitted` event, 1 initial result, 23 replays; changed-cart reuse fails |
| Unique guest checkout before stock reservation | 24 | 24 distinct submitted Orders; no Payment or stock consumed during checkout |
| Two shared ingredients, only 7 units of limiting ingredient | 24 | Exactly 7 accepted, 17 insufficient-stock conflicts; other ingredient partial debit must roll back |
| Cancel 3 accepted Orders from two devices each | 6 | Exactly 3 cancellations and 3 state conflicts; 6 return movements, 6 marked allocations |
| Re-accept single submitted Order from two devices | 2 | One winner, one CAS conflict; stock consumed once |
| Approve same unused ingredient return from two reviewer devices | 2 | One new movement, second idempotent replay |
| Expired/rotated QR (revoked visit) from old clients | 24 | No new Orders; all requests rejected |
| Forged cross-tenant Order status transition | 1 | No access, no mutation |
| Order/outbox/movement/payment integrity | final check | Atomic state/movements, no extra outbox event, all `payment_state=not_requested` |

All retries use the same explicit idempotency key; invalid changes are not
silently overwritten. Failures are classified by PostgreSQL SQLSTATE:
`P0004` (insufficient stock), `P0001` (stale Order state), `42501`
(invalid tenancy/QR access) and `23505` (changed idempotency payload).
An unexpected `40P01` deadlock, `55P03` lock timeout, connection error,
integrity violation or unintended permission is a **test failure**, not
a successful checkout.

## CI execution and diagnostic measurements

The PostgreSQL CI job provisions its own disposable PostgreSQL 16
`rcat_ci_test` database. The script guards against use outside
`CI=true`, the exact test database name and a loopback database address.
It seeds uniquely named test tenants and a dummy local session, never real
merchant credentials. All business mutations use `SET LOCAL ROLE rcat_auth`
and the repository's authenticated SECURITY DEFINER functions. Only the
fixture setup and final invariant verification use the ephemeral CI
database's privileged role.

Run locally **only in a disposable CI-equivalent database**, with migrations
and fixture roles present, for example:

```bash
CI=true PGDATABASE=rcat_ci_test PGHOST=127.0.0.1 \
  RCAT_LOAD_CLIENTS=24 node scripts/load/concurrent-orders.mjs
```

The harness supports 8–64 parallel tasks but caps actual PostgreSQL
connections at 16 to avoid destabilizing CI. It prints JSON summaries of
successes, failure SQLSTATE counts, and end-to-end p50/p95/max latency in
milliseconds. These times include pool wait and test-runner overhead.
**No artificial SLO or throughput target is claimed.** Measure real
p95/p99, CPU, Postgres waits, gateway limits, SSE connection counts, client
retries and dropped connections in separately isolated Staging before
considering capacity fit.

## Non-payment release gates not satisfied by this CI check

- Multi-user HTTP checkout and Merchant Browser E2E on actual mobile/desktop,
  with browser sleep/reconnect, SSE retry/backpressure and expired sessions.
- Sustained concurrent arrival rate and long-running soak; DB and app server
  metrics, resource exhaustion, network faults and failover behavior.
- Order and inventory database backup/restore with migration replay; RPO/RTO
  and recovery verification, retention and alerting.
- Staging threat-model signoff, operational incident response and deliberate
  operator/manual stock return abuse cases.

Do not interpret this regression as production readiness. **G5 PromptPay
per Order remains the final business feature**, followed by G6 integrated
security and real-money go/no-go.
