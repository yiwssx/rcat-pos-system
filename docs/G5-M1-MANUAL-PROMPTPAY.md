# G5-M1 — Manual PromptPay QR + Slip Upload + Merchant Confirmation

**Owner decision:** 13 Nov 2026. **Issue:** [#7](https://github.com/yiwssx/rcat-pos-system/issues/7). **Stage:** G5 final business module, after G4 operational evidence; no live funds or production deploy authorized by this specification.

## Decision and non-goals

- Keep existing printed/static **Ordering QR** and guest Order tracking unchanged.
- Create one logical payment obligation **per immutable Order**, use the respective store's own PromptPay receiving identifier and that Order's server-priced THB total. This is a **standard personal PromptPay amount QR**, not a bank-provided dynamically-referenced payment instrument. Two Orders with identical receiver and amount may have identical QR payloads: internal Order IDs do **not** establish distinct bank transaction references.
- The guest uploads transfer evidence; only an authorized Merchant human checking the **actual receiving bank transaction** may record **`manual_confirmed`**. A slip image, OCR, image hash, claimed reference, displayed QR or redirect is not independent evidence of settlement.
- Do **not** build a bank API, PSP/gateway, provider webhook, automatic verification/settlement, platform pooled receiving account or automatic refund in M1. Treat such integrations as future opt-in G5-M2 architecture, not a blocking dependency for M1.
- Production with customer money still needs G4 evidence, G5 focused adversarial checks and G6 owner-approved controlled pilot, recovery and go/no-go.

## Initial journey (UX design proposal, not an unreviewed automatic policy flip)

1. Customer scans existing table/store Ordering QR, chooses items and submits an Order. Backend retains server-authoritative immutable satang amount and `store_id`/`tenant_id`.
2. Merchant reviews availability, accepts the Order, and then payment is requested; **before enforcing pay-before-prepare** reconcile it with current stock-on-accept behavior and operational exceptions. A later pay-after-dining policy is separate future scope.
3. Backend pins the store receiving account snapshot and amount to a `payment_request`, exposes its payment QR and copy/save/import guidance suitable for one-phone banking.
4. Guest uploads receipt evidence through an Order-scoped tracking capability, with strict validation. Status is **submitted for review**, never **paid**. Repeated upload does not create another Order or additional debt.
5. Merchant inbox shows pending evidence and a clear instruction to check the bank's own incoming transaction. Owner/manager/cashier (subject to existing permissions) chooses confirm or reject, with explicit actor/time/reason and optimistic concurrency.
6. Guest sees **ร้านยืนยันรับชำระแล้ว** only after `manual_confirmed`, never **ธนาคารตรวจสอบแล้ว**. Notify merchant/guest via durable events, with reconnect recovery.
7. A paid-then-cancelled Order, late transfer, split/short/overpayment, duplicate payment, refund claim or receiver mismatch becomes a recorded exception. Merchant makes any refund externally and records independent refund evidence; never mark `refunded` solely from a button press.

## Proposed payment state machine

`not_requested` → `awaiting_payment` → `slip_submitted` → `under_review` → `manual_confirmed`.

- `under_review` → `rejected` → `awaiting_payment` (bounded new submission; preserve all previous attempts).
- `awaiting_payment` → `expired` or `payment_exception`. Expiry/cancellation **does not prove funds were never transferred**.
- `manual_confirmed` → `refund_requested` → `refund_recorded` only after merchant verifies external refund and attaches evidence. Preserve the original payment confirmation and its audit trail.
- `provider_verified` is reserved for future Bank/PSP integration; the M1 API must never produce it.
- Order status (submitted/accepted/preparing/served/cancelled) is **independent** of Payment status. Any pay-first preparation policy must be an explicitly reviewed server-side order policy.

## Model, invariants and boundaries

- Store-scoped merchant receiving configuration, including target identifier type, masked value and change audit. Reauthentication/privilege checks for changes; never allow a guest to set the destination. Store a receiver **snapshot per request** so later account edits cannot redirect past liabilities.
- Separate `payment_requests` (one active logical obligation per Order), `payment_attempts` (retry/QR lifecycle), `payment_evidence` (private slip metadata and immutable object key), `payment_events` (append-only state transitions), `payment_decisions` (authorized reviewer and outcome), `payment_exceptions` and `manual_refunds`.
- Referential constraints always include tenant/store/order scope. Use `amount_satang` from the existing committed Order snapshot; ignore guest-supplied amounts and receiving accounts. Set explicit limits, expiry, duplicate constraints and stable idempotency keys.
- Validate QR encoding, PromptPay receiver format and amount/currency against authoritative configuration; tests should use synthetic identifiers only. Never imply a bank-verifiable Order reference from standard QR alone.
- Manual review must check a **bank-recorded incoming transaction**, receiving account, exact amount and time; retain the reviewed bank transaction reference if available, but label it **merchant-entered**. Enforce single confirmation/duplicate transaction reference policy where possible, and safe concurrent review/confirm/reject state transitions.
- Image checksum, perceptual hash and OCR may flag suspicious reuse but must never upgrade to a verified state or reject legitimate transfers without human review.
- Merchant daily reconciliation should distinguish `orders_total`, `manual_confirmed_total`, `unverified_total`, `refund_recorded_total` and `exceptions`. No claim of bank-level automated settlement.

## Security and privacy

- Require valid Order-specific guest capability for upload. Use authenticated merchant RBAC/CSRF for review; enforce row-level tenant boundaries in database access and private evidence retrieval.
- Allow explicitly selected image formats with magic-byte inspection, bounded bytes/pixels, content disposition, image normalization and malware checks where deployed; apply rate limits, quota and abuse monitoring. Never render arbitrary uploaded SVG/HTML/script.
- Private object storage outside public/static directories with unguessable names; short-lived authenticated access only. No raw slips, receiver personal identifiers, bank transaction details, guest tokens or session cookies in repo, tests, logs, analytics, screenshots or public URLs.
- Document approved retention and disposal periods before live money. Treat slips and receiving identifiers as personal/financial data, with restricted support access and audit logging.
- Disable automatic paid status and automated disbursement; no unilateral re-use of one evidence attachment across multiple Orders.

## Focused acceptance tests

1. Correct store PromptPay target, THB amount and QR decode, including two distinct Orders with equal QR payload: never confuse settlement.
2. Duplicate checkout, double tap, repeated/parallel slip uploads and concurrent merchant confirm/reject: exactly one authoritative terminal outcome with immutable review events.
3. Forged slip, altered receipt, same slip on two Orders, claimed fake transaction reference and direct guest calls to payment endpoints: do not mark paid.
4. Wrong tenant/store Order, stale/revoked tracking token, unauthorized staff, malicious content/oversized image, file object ID enumeration and private evidence exposure: deny.
5. Late bank transfer after expiry/cancel, incorrect receiver, partial/overpayment, refund dispute and duplicate manual record: route to explicit exception/reconciliation, no automatic refund claim.
6. Merchant phone sleep/reconnect and weak connection during upload/review: no lost evidence, duplicate decision, or false completion.
7. Mobile UI/Thai text accessibility and same-phone QR-save workflow; clear `manual_confirmed` wording.
8. Staging-only synthetic validation plus retained G4 evidence under the Human-triggered Evidence-aware Engineering Loop. G6 requires operator review and explicit approval; docs-only PR cannot close #7.

## Delivery sequence

1. Confirm G4 readiness and owner-approved payment acceptance policy, merchant receiver onboarding, evidence retention, exception ownership and role permissions.
2. Implement isolated database migrations/contracts, scoped receiver settings, audit/event model and non-live QR generation.
3. Implement private receipt upload, merchant manual review queue and guest statuses.
4. Add focused concurrent/security/exception tests and operational reports; avoid redundant unrelated regressions if retained CI evidence remains applicable.
5. Conduct supervised staging UAT on synthetic data; separately approve any controlled real-money pilot and production release.

**Non-negotiable:** A merchant confirmation is an accountable human attestation, **not** a bank-authenticated receipt. No real money until approved release gates.
