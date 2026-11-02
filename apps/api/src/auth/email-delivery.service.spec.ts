import { describe, expect, it, vi } from "vitest";
import { EmailDeliveryService, buildActionEmail } from "./email-delivery.service";

describe("email delivery (no outbound network)", () => {
  it("constructs a provider-neutral message with a fragment-only secret", () => {
    const mail = buildActionEmail(
      "reset-password",
      "owner@test.invalid",
      "secret-token",
      "https://pos.example.test/account",
    );
    expect(mail.subject).toContain("Reset");
    expect(mail.text).toContain("#token=secret-token");
    expect(mail.text).toContain("20 minutes");
    expect(mail.idempotencyKey).not.toContain("secret-token");
  });

  it("rejects unsafe action URLs", () => {
    expect(() =>
      buildActionEmail("verify-email", "a@test.invalid", "token", "http://example.test"),
    ).toThrow();
    expect(() =>
      buildActionEmail("verify-email", "a@test.invalid", "token", "https://user:pass@example.test"),
    ).toThrow();
  });

  it("uses the fixed Resend API and keeps credentials out of the body", async () => {
    const fn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 200 }));
    const original = { ...process.env };
    try {
      process.env["MAIL_PROVIDER"] = "resend";
      process.env["RESEND_API_KEY"] = "mocked-secret-key";
      process.env["MAIL_FROM_EMAIL"] = "no-reply@example.test";
      process.env["EMAIL_ACTION_BASE_URL"] = "https://pos.example.test/account";
      vi.stubGlobal("fetch", fn);
      const mailer = new EmailDeliveryService();
      await mailer.sendAction("verify-email", "user@test.invalid", "test-token");
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
      const opts = fn.mock.calls[0]?.[1] as RequestInit;
      expect(opts.redirect).toBe("error");
      expect(opts.body).not.toContain("mocked-secret-key");
    } finally {
      process.env = original;
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when a mail provider is unavailable", async () => {
    const original = { ...process.env };
    try {
      delete process.env["MAIL_PROVIDER"];
      await expect(
        new EmailDeliveryService().sendAction("reset-password", "u@test.invalid", "secret"),
      ).rejects.toThrow("Email transport unavailable");
    } finally {
      process.env = original;
    }
  });
});
