import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  digestOpaqueSecret,
  hashPassword,
  newOpaqueSecret,
} from "../../../../libs/server-auth/src";
import { normalizeRegistrationEmail } from "../../../../libs/server-auth/src/registration";
import { DatabaseAccess } from "../database/db-access";
import { EmailDeliveryService } from "./email-delivery.service";

function requireIsolatedTestMode(): void {
  // A real signup endpoint requires configured email delivery + rate limits.
  // Never return an email verification token from a deployed API.
  if (
    process.env["CI"] !== "true" ||
    process.env["NODE_ENV"] !== "test" ||
    process.env["ENABLE_REGISTRATION_TEST_MODE"] !== "true" ||
    process.env["ENABLE_DEVELOPMENT_AUTH"] !== "true"
  ) {
    throw new ServiceUnavailableException("Email registration is not enabled");
  }
}

@Injectable()
export class EmailRegistrationService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly mail: EmailDeliveryService,
  ) {}

  async register(raw: unknown): Promise<{
    status: "pending_verification";
    testVerificationToken?: string;
  }> {
    requireIsolatedTestMode();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("Invalid registration");
    }
    const body = raw as Record<string, unknown>;
    let email: string;
    try {
      email = normalizeRegistrationEmail(body["email"]);
    } catch {
      throw new BadRequestException("Invalid registration");
    }
    const password = body["password"];
    if (typeof password !== "string") {
      throw new BadRequestException("Invalid registration");
    }
    let encoded: string;
    try {
      encoded = await hashPassword(password);
    } catch {
      throw new BadRequestException("Invalid registration");
    }
    const token = newOpaqueSecret();
    const digest = digestOpaqueSecret(token);
    const result = await this.database.auth((client) =>
      client.query<{ accepted: boolean }>(
        "SELECT rcat_private.request_email_registration($1,$2,$3) AS accepted",
        [email, encoded, digest],
      ),
    );
    if (result.rows[0]?.accepted) {
      try {
        await this.mail.sendAction("verify-email", email, token);
      } catch {
        await this.database.auth((client) =>
          client.query("SELECT rcat_private.cancel_email_registration($1)", [
            digest,
          ]),
        );
        return { status: "pending_verification" };
      }
      // Verification token is returned ONLY to isolated CI tests.
      return { status: "pending_verification", testVerificationToken: token };
    }
    return { status: "pending_verification" };
  }

  async verify(raw: unknown): Promise<{ verified: true }> {
    requireIsolatedTestMode();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new NotFoundException("Verification unavailable");
    }
    const token = (raw as Record<string, unknown>)["token"];
    if (typeof token !== "string") {
      throw new NotFoundException("Verification unavailable");
    }
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Verification unavailable");
    }
    try {
      await this.database.auth((client) =>
        client.query("SELECT rcat_private.complete_email_registration($1)", [
          digest,
        ]),
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: unknown }).code
          : undefined;
      if (code === "42501" || code === "23505") {
        throw new NotFoundException("Verification unavailable");
      }
      throw error;
    }
    return { verified: true };
  }
}
