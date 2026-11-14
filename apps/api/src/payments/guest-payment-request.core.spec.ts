import { describe, expect, it } from "vitest";
import { guestPaymentQrEnvelope } from "./guest-payment-request.core";

const orderId = "11111111-1111-4111-8111-111111111111";
const approved = {
  available: true,
  requestId: "22222222-2222-4222-8222-222222222222",
  orderId,
  amountSatang: 20005,
  currency: "THB",
  state: "awaiting_payment",
  receiverKind: "mobile",
  receiverId: "0812345678",
  createdAt: "2026-11-14T00:00:00Z",
};

describe("G5-M1 guest payment request pure trust boundary", () => {
  it("never exposes a receiver or QR for a release-disabled request", () => {
    expect(guestPaymentQrEnvelope(orderId, { available: false })).toEqual({
      available: false,
    });
  });

  it("converts only an authorized DB snapshot into a fixed-amount Thai QR", () => {
    const result = guestPaymentQrEnvelope(orderId, approved);
    if (!result.available) throw new Error("Expected QR");
    expect(result.amountSatang).toBe(20005);
    expect(result.currency).toBe("THB");
    expect(result.state).toBe("awaiting_payment");
    expect(result.qrPayload).toContain("5303764");
    expect(result.qrPayload).toContain("5406200.05");
    expect(JSON.stringify(result)).not.toContain('"receiverId"');
    expect(JSON.stringify(result)).not.toContain('"receiverKind"');
  });

  it("does not forge a per-Order bank reference from repeated recipient/amount", () => {
    const first = guestPaymentQrEnvelope(orderId, approved);
    const second = guestPaymentQrEnvelope(
      "33333333-3333-4333-8333-333333333333",
      {
        ...approved,
        requestId: "44444444-4444-4444-8444-444444444444",
        orderId: "33333333-3333-4333-8333-333333333333",
      },
    );
    if (!first.available || !second.available) throw new Error("Expected QR");
    expect(first.qrPayload).toBe(second.qrPayload);
    expect(first.requestId).not.toBe(second.requestId);
  });

  it.each([
    { orderId: "33333333-3333-4333-8333-333333333333" },
    { currency: "USD" },
    { state: "manual_confirmed" },
    { receiverKind: "bank_account" },
    { receiverId: "1234567890" },
    { amountSatang: -1 },
    { amountSatang: 0 },
    { amountSatang: 200.5 },
    { amountSatang: 100000001 },
    { amountSatang: "20005" },
  ])("rejects invalid or forged server snapshots %j", (bad) => {
    expect(() => guestPaymentQrEnvelope(orderId, { ...approved, ...bad })).toThrow();
  });
});
