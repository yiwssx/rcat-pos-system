/** Pure fail-closed validation of manual finance forms (no bank API). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PAYMENT_EXCEPTION_KINDS = [
  "underpayment",
  "overpayment",
  "duplicate_transfer",
  "late_transfer",
  "cancelled_after_transfer",
  "unmatched_transfer",
  "other",
] as const;
export type PaymentExceptionKind = (typeof PAYMENT_EXCEPTION_KINDS)[number];

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid manual finance request");
  }
  return raw as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join(",") !== expected.sort().join(",")) {
    throw new Error("Unexpected manual finance fields");
  }
}
function positiveMoney(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    raw < 1 ||
    raw > 100_000_000
  ) {
    throw new Error("Amount must be exact integer satang");
  }
  return raw;
}
function note(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Invalid finance note");
  const value = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (
    Array.from(value).length < 4 ||
    Array.from(value).length > 240 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Finance note must be 4–240 visible characters");
  }
  return value;
}
function revision(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    raw < 1 ||
    raw > 2147483646
  ) {
    throw new Error("Invalid expected revision");
  }
  return raw;
}
function optionalOrderId(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || !UUID.test(raw)) {
    throw new Error("Invalid Order reference");
  }
  return raw;
}
function bankRef(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9._-]{6,64}$/.test(raw)) {
    throw new Error("External bank transaction reference required");
  }
  return raw.toUpperCase();
}
export function parseFinanceDays(raw: unknown): number {
  if (raw === undefined) return 30;
  if (typeof raw !== "string" || !/^(?:[1-9]|[1-8][0-9]|90)$/.test(raw)) {
    throw new Error("Report window must be 1–90 days");
  }
  return Number(raw);
}
export function parseRefundRequest(raw: unknown) {
  const input = object(raw);
  keys(input, ["orderId", "amountSatang", "reason"]);
  return {
    orderId:
      optionalOrderId(input["orderId"]) ??
      (() => {
        throw new Error("Order ID required");
      })(),
    amountSatang: positiveMoney(input["amountSatang"]),
    reason: note(input["reason"]),
  };
}
export function parseRefundDecision(raw: unknown) {
  const input = object(raw);
  const action = input["action"];
  if (action === "void") {
    keys(input, ["action", "expectedRevision"]);
    return {
      action: "void" as const,
      expectedRevision: revision(input["expectedRevision"]),
      bankReference: null,
      actualAmountSatang: null,
      bankChecked: false,
    };
  }
  if (action !== "record") throw new Error("Invalid refund action");
  keys(input, [
    "action",
    "expectedRevision",
    "bankReference",
    "actualAmountSatang",
    "bankChecked",
  ]);
  if (input["bankChecked"] !== true)
    throw new Error("Bank outflow not checked");
  return {
    action: "record" as const,
    expectedRevision: revision(input["expectedRevision"]),
    bankReference: bankRef(input["bankReference"]),
    actualAmountSatang: positiveMoney(input["actualAmountSatang"]),
    bankChecked: true,
  };
}
export function parsePaymentException(raw: unknown) {
  const input = object(raw);
  keys(input, ["orderId", "kind", "amountSatang", "note"]);
  const kind = input["kind"];
  if (
    typeof kind !== "string" ||
    !PAYMENT_EXCEPTION_KINDS.some((x) => x === kind)
  ) {
    throw new Error("Invalid exception category");
  }
  return {
    orderId: optionalOrderId(input["orderId"]),
    kind: kind as PaymentExceptionKind,
    amountSatang:
      input["amountSatang"] === null
        ? null
        : positiveMoney(input["amountSatang"]),
    note: note(input["note"]),
  };
}
export function parseExceptionResolution(raw: unknown) {
  const input = object(raw);
  keys(input, ["expectedRevision", "resolution"]);
  return {
    expectedRevision: revision(input["expectedRevision"]),
    resolution: note(input["resolution"]),
  };
}
