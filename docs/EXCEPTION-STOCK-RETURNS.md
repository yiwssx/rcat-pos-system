# Exception Stock Return after Preparation — G3 / #9

**Status:** Operational inventory exception; **not** a refund, cancellation,
Payment, or PromptPay feature. This is for only unused and physically
recoverable ingredients when an Order is `preparing` or `served`.

## Strict physical policy

- Only `unused_unopened` (unopened stock) or
  `kitchen_error_unconsumed` (unused excess stock held safely) is eligible.
  The request must state evidence and quantities. **Never** return ingredients
  already cooked, mixed, contaminated, discarded, or consumed. Waste/spoilage
  is not a positive stock return.
- The original Order stays `preparing` or `served`; its immutable items,
  amount in satang, `payment_state=not_requested`, Bill and Outbox are unchanged.
  No cancellation or automatic refund is implied.
- Owner/manager starts a request; a **different** active owner/manager must
  approve or reject. Kitchen and cashier cannot authorize these corrections.
- A request is bound to one immutable `inventory_order_allocations` row.
  Approved cumulative returns cannot exceed that allocation's original
  `quantity`. The system does **not** recalculate from current recipes.
- Only one pending exception per Order/ingredient. The retry UUID and full
  payload are bound to the same actor; unchanged retries return their original
  result, even if already approved. Reuse with a different payload is a 409.
- Approval serializes on the Order row, then the request, then the ingredient.
  This is the same global Order-first lock order as status transition.
  PostgreSQL transactions atomically: verify a second identity and remaining
  allocation; lock the current stock balance; write exact positive
  `exception_return` movement, Stock Version trigger, final request state
  and immutable Audit event. Rejections only write state and Audit.
- A network timeout must be retried with the **same** UUID. Never submit a
  second request simply because the first confirmation was lost.
- Requests and reviews are tenant/store scoped by authenticated Session and
  restricted PostgreSQL SECURITY DEFINER routines. All write APIs require
  allowed Origin and CSRF. Underlying inventory/exception/movement tables
  remain inaccessible to runtime DB roles.

## API and Merchant UI

All endpoints are under
`/api/tenants/:tenantId/stores/:storeId/inventory`:

- `GET /exception-returns/:orderId`: authorized view of frozen ingredient
  allocations, exact previously approved/remaining quantities and recent
  pending/reviewed requests; `Cache-Control: no-store`.
- `POST /exception-returns/:orderId`: Owner/Manager request with
  `{itemId, idempotencyKey, quantity, category, reason}`; quantity is an
  exact decimal **string**, up to three fractional digits and 1e9 units.
  Reason is 10–200 trimmed characters.
- `POST /exception-returns/requests/:requestId/review`: another
  Owner/Manager submits `{approve:true|false}`. Same reviewer/same decision
  replay is idempotent; conflicting or self-review is 409.

In the Merchant Order Board, Owner/Manager users see
**คืนสต็อกกรณีพิเศษ** for orders marked preparing/served. The responsive
screen exposes original allocation, cumulative return, remaining quantity,
request form and separate review actions. UI eligibility is only UX:
PostgreSQL enforces actual permissions and quantities.

## Deliberately out of scope / release gate

- No returns for `submitted`, `accepted` or cancelled Orders. Existing
  `accepted → cancelled` automatic allocation return remains unchanged.
- No authorization based on client-supplied identifiers alone, no negative
  inventory, duplicate return movement, automatically restocked waste, or
  claim that a refund/payment was processed.
- No verified recipe-lot/expiry tracking or real kitchen proof-of-condition:
  users must inspect the physical goods. The category/reason/audit are
  controls, not proof of safe reuse.
- Before production: test multi-device simultaneous approvals, ingredient
  contention with Order acceptance and Stocktake, load, browser E2E, operator
  identity, audit retention and PostgreSQL backup/restore. Payment stays **G5
  LAST** and Production deployment is not authorized by this PR.

## Verification

- `tests/db/order-exception-stock-return.sql`: prepare an Order with tracked
  ingredients, deny pre-preparation and waste returns, verify client isolation,
  idempotent create/review, independent reviewer, exact partial and full
  return ceiling, audit/movement accounting and unchanged Order/Payment.
- `apps/api/src/inventory/inventory.core.spec.ts`: strict UUID, category,
  exact decimal and reason validation.
- `apps/merchant/src/app/app.spec.ts`: bounded milliquantity UI and scoped
  lazy route.
- `scripts/smoke-inventory.mjs`: HTTP Origin, CSRF and tenant/role checks.

Use ephemeral CI fixtures and do **not** deploy to Production with real
merchant funds.
