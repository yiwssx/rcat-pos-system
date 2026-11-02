import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";

export type EmailPurpose = "verify-email" | "reset-password";

interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

type FetchFunction = typeof fetch;

export function buildActionEmail(
  purpose: EmailPurpose,
  to: string,
  secret: string,
  baseUrl: string,
): OutgoingEmail {
  // Base URL is a trusted operator-controlled setting, never client input.
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(process.env["CI"] === "true" && url.origin.startsWith("http://127.0.0.1:")))
  ) {
    throw new Error("An approved email action HTTPS origin is required");
  }
  const path = purpose === "verify-email" ? "verify-email" : "reset-password";
  const actionUrl = new URL(path, url.href.endsWith("/") ? url.href : url.href + "/");
  // Fragment is handled by the customer-facing frontend, not sent to servers or
  // reverse-proxy access logs. Angular must remove it once read.
  actionUrl.hash = `token=${encodeURIComponent(secret)}`;
  const subject =
    purpose === "verify-email" ? "Verify your RCAT POS email" : "Reset your RCAT POS password";
  const minutes = purpose === "verify-email" ? 30 : 20;
  const text =
    `RCAT POS requested an account action.\n\nOpen this link to continue:\n${actionUrl.toString()}\n\n` +
    `This link expires in ${minutes} minutes. If you did not request it, ignore this email.\n`;
  const idempotencyKey = createHash("sha256")
    .update(purpose + ":" + to + ":" + secret)
    .digest("hex");
  return { to, subject, text, idempotencyKey };
}

@Injectable()
export class EmailDeliveryService {
  private readonly http: FetchFunction = (...args) => fetch(...args);

  async sendAction(purpose: EmailPurpose, to: string, secret: string): Promise<void> {
    const provider = process.env["MAIL_PROVIDER"];
    if (provider === "test") {
      // No outbound network and no token logging. Only isolated CI mode.
      if (
        process.env["CI"] !== "true" ||
        process.env["NODE_ENV"] !== "test" ||
        process.env["ENABLE_REGISTRATION_TEST_MODE"] !== "true"
      ) {
        throw new ServiceUnavailableException("Email transport unavailable");
      }
      return;
    }
    if (provider !== "resend") {
      throw new ServiceUnavailableException("Email transport unavailable");
    }
    const key = process.env["RESEND_API_KEY"];
    const from = process.env["MAIL_FROM_EMAIL"];
    const base = process.env["EMAIL_ACTION_BASE_URL"];
    if (
      !key ||
      !from ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ||
      !base
    ) {
      throw new ServiceUnavailableException("Email transport not configured");
    }
    let message: OutgoingEmail;
    try {
      message = buildActionEmail(purpose, to, secret, base);
    } catch {
      throw new ServiceUnavailableException("Email action URL invalid");
    }
    try {
      // Fixed HTTPS endpoint prevents provider URL injection / arbitrary SSRF.
      const response = await this.http("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(6000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Mail provider rejected request");
    } catch {
      // Do not emit provider response text, API keys, token, or recipient in logs.
      throw new ServiceUnavailableException("Email transport failed");
    }
  }
}
