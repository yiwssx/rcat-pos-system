import { ForbiddenException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthService } from "../auth/auth.service";
import type { ApiRequest } from "../auth/request-security";
import type { DatabaseAccess } from "../database/db-access";
import { PlatformPaymentApprovalCore } from "./platform-payment-approval.core";

const tenant = "10000000-0000-4000-8000-000000000101";
const store = "10000000-0000-4000-8000-000000000102";
const req = { headers: {} } as ApiRequest;
const approval = {
  action: "approve",
  approvalRef: "CI-proof-001",
  expectedRevision: 1,
  verifiedReceiverId: "0812345678",
};
function fixture(role: "super_admin" | "admin" | "merchant" = "admin") {
  const query = vi.fn(async () => ({ rows: [{ data: { canReview: true } }] }));
  const auth = {
    session: vi.fn(async () => ({
      platformRole: role,
      token: Buffer.alloc(32, 7).toString("base64url"),
    })),
    requireCsrf: vi.fn(),
  };
  const database = {
    auth: vi.fn(async (fn: (client: { query: typeof query }) => unknown) =>
      fn({ query }),
    ),
  };
  return {
    service: new PlatformPaymentApprovalCore(
      auth as unknown as AuthService,
      database as unknown as DatabaseAccess,
    ),
    auth,
    query,
  };
}
function environment(ready: boolean) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ENABLE_DEVELOPMENT_AUTH", "false");
  vi.stubEnv("RCAT_POS_PAYMENT_QR_RELEASE_APPROVED", String(ready));
  vi.stubEnv("RCAT_POS_PAYMENT_SLIP_RELEASE_APPROVED", String(ready));
}
afterEach(() => vi.unstubAllEnvs());

describe("platform payment web approval boundary", () => {
  it("requires platform role and CSRF for state changes before database access", async () => {
    const merchant = fixture("merchant");
    await expect(merchant.service.overview(req, undefined)).rejects.toThrow();
    await expect(
      merchant.service.review(req, tenant, store, approval),
    ).rejects.toThrow();
    expect(merchant.query).not.toHaveBeenCalled();
    const admin = fixture();
    admin.auth.requireCsrf.mockImplementation(() => {
      throw new ForbiddenException("CSRF");
    });
    await expect(
      admin.service.review(req, tenant, store, approval),
    ).rejects.toThrow("CSRF");
    expect(admin.query).not.toHaveBeenCalled();
  });

  it("rejects client release assertions, forged actor or unknown fields", async () => {
    const { service, query } = fixture();
    for (const body of [
      { ...approval, releaseReady: true },
      { ...approval, actorId: tenant },
      { ...approval, expectedRevision: "1" },
      { ...approval, verifiedReceiverId: null },
      { ...approval, action: "revoke" },
    ]) {
      await expect(service.review(req, tenant, store, body)).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("uses server-only release controls and keeps the raw verified ID out of responses", async () => {
    const { service, query, auth } = fixture();
    environment(false);
    await expect(service.review(req, tenant, store, approval)).resolves.toEqual(
      { changed: true },
    );
    expect(auth.requireCsrf).toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("review_platform_payment_receiver"),
      [
        expect.any(Buffer),
        tenant,
        store,
        1,
        "approve",
        "0812345678",
        "CI-proof-001",
        false,
      ],
    );
    environment(true);
    await service.review(req, tenant, store, approval);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      expect.any(Buffer),
      tenant,
      store,
      1,
      "approve",
      "0812345678",
      "CI-proof-001",
      true,
    ]);
    vi.stubEnv("ENABLE_DEVELOPMENT_AUTH", "true");
    await service.review(req, tenant, store, approval);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      expect.any(Buffer),
      tenant,
      store,
      1,
      "approve",
      "0812345678",
      "CI-proof-001",
      false,
    ]);
  });

  it("permits a revoke request with release controls off; does not expose SQL error detail", async () => {
    const { service, query } = fixture();
    environment(false);
    await service.review(req, tenant, store, {
      action: "revoke",
      approvalRef: "CI-stop-001",
      expectedRevision: 1,
      verifiedReceiverId: null,
    });
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      expect.any(Buffer),
      tenant,
      store,
      1,
      "revoke",
      null,
      "CI-stop-001",
      false,
    ]);
    query.mockRejectedValueOnce({ code: "P0009", detail: "sensitive detail" });
    await expect(service.review(req, tenant, store, approval)).rejects.toThrow(
      "Receiver changed; reload approval queue",
    );
  });
});
