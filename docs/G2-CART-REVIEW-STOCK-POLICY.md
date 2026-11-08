# G2/G3 — Cart-only Guest review and explicit stock / sold-out policy

**Scope:** Checkout preflight optimization and safety coverage only. This PR
does **not** implement a checkout-time reservation or automatic sold-out
algorithm; no Payment or Production is enabled.

## Cart validation

1. The Guest loads at most 24 products at a time from the server. The in-memory
   cart retains the exact product/option snapshots the guest selected.
2. Before checkout, the customer sends `POST
   /api/guest/ordering-visit/review-cart`, body `{token,items}`. This uses the
   same fixed Origin and cross-instance request budget as visit resolution.
   The backend allows at most 20 cart lines, 32 options per line and 100
   units total, then returns a read-only snapshot containing **only requested
   products, their current categories, all applicable modifier group rules,
   and only the selected currently-available options**. No whole-store
   product or option snapshot is downloaded.
3. PostgreSQL validates the active QR/grant and table in the same restricted
   security-definer scope as the existing Guest menu endpoint. Missing or
   withdrawn products/options are intentionally **absent** from the snapshot
   and trigger explicit review. The client merges the scoped review with
   previously loaded unrelated pages without resurrecting removed cart items.
4. When anything relevant changed (product/category/option identity, option
   name or price, group rule, availability, per-line amount), the UI stops
   checkout and requests reconfirmation. The UI never claims success or
   Payment verification on preflight.
5. **Critically:** Preflight is advisory / read-only. The existing
   `place_guest_order` PostgreSQL transaction re-locks and revalidates
   the active visit, all products, quantities, modifiers and satang prices.
   Replayed identical Idempotency-Keys remain deterministic. A race between
   preflight and checkout is resolved at the Order transaction, not by
   trusting the browser.

## Sold-out operational policy awaiting operator approval

- The existing Merchant product `available` switch is the intentional
  manual sold-out control; withdrawn items do not appear in new Guest pages
  or scoped checkout reviews.
- Tracked ingredient stock is consumed on **merchant acceptance**, not
  guest submission. A shortage rejects acceptance atomically without
  partially deducting the stock ledger or marking the Order accepted.
- **No automatic inventory-based product deactivation, no advance
  reservation, no stock quantity exposed to guests.** Untracked or
  incomplete optional recipes make an automatic sold-out claim unreliable.
- Before automatic sold-out is considered, owners must approve policy for
  shared ingredients, modifier recipe stock, outstanding submitted orders,
  reconciliation, restocking and what guests should see on rejection.
  Do not silently change this financial/fulfilment invariant.

## Qualification

- PostgreSQL CI: bounded cart-only snapshot, selected option visibility,
  withdrawn product removal, invalid QR and restricted role safety.
- Angular tests: old cart snapshot reconfirmation and preservation of
  unrelated paginated products.
- Browser/HTTP CI: compare JSON response bytes against full Guest resolve
  with 31 products and reject over-limit cart, forged token and bad Origin.
- Remaining Staging gates: measured end-to-end p95 on realistic 500+ product
  stores, NAT/proxy fairness, mobile QR/slow network and accessibility.
