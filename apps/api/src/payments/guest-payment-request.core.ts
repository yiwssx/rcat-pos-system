import { buildPromptPayPayload } from "./promptpay-qr.core";

interface PaymentRequestRow {
  available?: unknown;
  requestId?: unknown;
  orderId?: unknown;
  amountSatang?: unknown;
  currency?: unknown;
  state?: unknown;
  receiverKind?: unknown;
  receiverId?: unknown;
  createdAt?: unknown;
}

export type GuestPaymentQrEnvelope =
  | { available: false }
  | {
      available: true;
      requestId: string;
      orderId: string;
      amountSatang: number;
      currency: "THB";
      state: "awaiting_payment";
      createdAt: string;
      qrPayload: string;
    };

/** A pure trust boundary between the DB snapshot and the public QR renderer. */
export function guestPaymentQrEnvelope(
  requestedOrderId: string,
  raw: unknown,
): GuestPaymentQrEnvelope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid server payment response");
  }
  const data = raw as PaymentRequestRow;
  if (data.available !== true) return { available: false };
  if (
    typeof data.requestId !== "string" ||
    typeof data.orderId !== "string" ||
    data.orderId.toLowerCase() !== requestedOrderId.toLowerCase() ||
    data.currency !== "THB" ||
    data.state !== "awaiting_payment" ||
    typeof data.createdAt !== "string" ||
    (data.receiverKind !== "mobile" && data.receiverKind !== "national_id") ||
    typeof data.receiverId !== "string"
  ) {
    throw new Error("Invalid server payment snapshot");
  }
  // PostgreSQL JSONB bigint values fit our strictly bounded 100,000,000 satang
  // range. Accept only canonical numeric values; never parse arbitrary strings.
  const amountSatang = data.amountSatang;
  if (
    typeof amountSatang !== "number" ||
    !Number.isSafeInteger(amountSatang) ||
    amountSatang < 1 ||
    amountSatang > 100_000_000
  ) {
    throw new Error("Invalid server payment snapshot");
  }
  const qrPayload = buildPromptPayPayload({
    receiverKind: data.receiverKind,
    receiverId: data.receiverId,
    amountSatang,
  });
  return {
    available: true,
    requestId: data.requestId,
    orderId: data.orderId,
    amountSatang,
    currency: "THB",
    state: "awaiting_payment",
    createdAt: data.createdAt,
    qrPayload,
  };
}
