import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  buildActionEmail,
  sendResendEmail,
  EmailPurpose,
} from "./email-delivery.core";

@Injectable()
export class EmailDeliveryService {
  async sendAction(
    purpose: EmailPurpose,
    to: string,
    secret: string,
  ): Promise<void> {
    const provider = process.env["MAIL_PROVIDER"];
    if (provider === "test") {
      // Never expose test-mail behavior outside isolated CI.
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
    if (!key || !from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) || !base) {
      throw new ServiceUnavailableException("Email transport not configured");
    }
    try {
      const message = buildActionEmail(purpose, to, secret, base);
      await sendResendEmail(message, key, from);
    } catch {
      // Never leak remote status, recipients, token or provider credentials.
      throw new ServiceUnavailableException("Email transport failed");
    }
  }
}
