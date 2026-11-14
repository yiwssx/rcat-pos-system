import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { GuestPaymentRequestService } from "./guest-payment-request.service";
import { DatabaseAccess } from "../database/db-access";
import { GuestRequestBudgetService } from "../ordering/guest-request-budget.service";
import { ApiRequest } from "../auth/request-security";

const orderId = "11111111-1111-4111-8111-111111111111";
const token = Buffer.alloc(32, 0x31).toString("base64url");

function fixture(data: Record<string, unknown>) {
  const query = vi.fn().mockResolvedValue({ rows: [{ data }] });
  const database = {
    auth: vi.fn((cb: (client: { query: typeof query }) => unknown) =>
      cb({ query }),
    ),
  } as unknown as DatabaseAccess;
  const consume = vi.fn().mockResolvedValue(undefined);
  const budgets = { consume } as unknown as GuestRequestBudgetService;
  const service = new GuestPaymentRequestService(database, budgets);
  const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as ApiRequest;
  return { service, req, consume, query };
}

afterEach(() => vi.unstubAllEnvs());

describe("G5-M1 post-Order payment request (fail-closed)", () => {
  it("does not expose receiver or QR when global release flag is absent", async () => {
    vi.stubEnv("RCAT_POS_PAYMENT_QR_RELEASE_APPROVED", "");
    const { service, req, query, consume } = fixture({ available: false });
    expect(await service.request(req, orderId, `Bearer ${token}`)).toEqual({
      available: false,
    });
    expect(consume).toHaveBeenCalledWith(req, "tracking", token);
    expect(query.mock.calls[0]?.[1]?.[2]).toBe(false);
  });

  it("does not leak the existence of other Orders without their tracking bearer", async () => {
    const { service, req, query } = fixture({ available: false });
    await expect(service.request(req, orderId, "Bearer forged")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.request(req, "malformed", `Bearer ${token}`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("renders a real server QR only when SQL returned an approved request", async () => {
    vi.stubEnv("RCAT_POS_PAYMENT_QR_RELEASE_APPROVED", "true");
    const { service, req, query } = fixture({
      available: true,
      requestId: "22222222-2222-4222-8222-222222222222",
      orderId,
      amountSatang: 20005,
      currency: "THB",
      state: "awaiting_payment",
      receiverKind: "mobile",
      receiverId: "0812345678",
      createdAt: "2026-11-14T00:00:00Z",
    });
    const result = await service.request(req, orderId, `Bearer ${token}`);
    expect(query.mock.calls[0]?.[1]?.[2]).toBe(true);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("Expected QR");
    expect(result.amountSatang).toBe(20005);
    expect(result.state).toBe("awaiting_payment");
    expect(result.merchantConfirmation).toBe(false);
    expect(result.qrSvg).toContain("<svg");
    expect(JSON.stringify(result)).not.toContain("receiverId");
    expect(JSON.stringify(result)).not.toContain("0812345678");
  });

  it("rejects corrupted Order/amount snapshots rather than returning a QR", async () => {
    vi.stubEnv("RCAT_POS_PAYMENT_QR_RELEASE_APPROVED", "true");
    const { service, req } = fixture({
      available: true,
      requestId: "22222222-2222-4222-8222-222222222222",
      orderId: "33333333-3333-4333-8333-333333333333",
      amountSatang: 20005,
      currency: "THB",
      state: "awaiting_payment",
      receiverKind: "mobile",
      receiverId: "0812345678",
    });
    await expect(service.request(req, orderId, `Bearer ${token}`)).rejects.toThrow(
      "Invalid server payment snapshot",
    );
  });
});
