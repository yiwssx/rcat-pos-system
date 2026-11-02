import { describe, expect, it, vi } from "vitest";
import { buildActionEmail, sendResendEmail } from "./email-delivery.core";

describe("email provider adapter (no outbound network)", () => {
  it("creates an action link with token in fragment only", () => {
    const message = buildActionEmail(
      "reset-password",
      "user@test.invalid",
      "unique-test-token",
      "https://pos.example.test/account",
    );
    expect(message.subject).toContain("Reset");
    expect(message.text).toContain("#token=unique-test-token");
    expect(message.text).toContain("20 minutes");
    expect(message.idempotencyKey).not.toContain("unique-test-token");
  });

  it("rejects untrusted action URL protocols and URL credentials", () => {
    expect(() =>
      buildActionEmail("verify-email", "u@test.invalid", "token", "http://example.test"),
    ).toThrow();
    const credentialUrl = "https://" + "person:password" + "@example.test";
    expect(() =>
      buildActionEmail("verify-email", "u@test.invalid", "token", credentialUrl),
    ).toThrow();
  });

  it("calls only the fixed Resend endpoint using an idempotency key", async () => {
    const fn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
    );
    const message = buildActionEmail(
      "verify-email", "user@test.invalid", "token", "https://pos.example.test/account",
    );
    await sendResendEmail(message, "mocked-token", "no-reply@example.test", fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
    const options = fn.mock.calls[0]?.[1] as RequestInit;
    expect(options.redirect).toBe("error");
    expect(options.body).not.toContain("mocked-token");
  });

  it("fails when the provider rejects the email", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 429 }));
    const message = buildActionEmail(
      "reset-password", "user@test.invalid", "token", "https://pos.example.test/account",
    );
    await expect(sendResendEmail(
      message, "mocked-token", "no-reply@example.test", mock,
    )).rejects.toThrow("Mail transport unsuccessful");
  });
});
