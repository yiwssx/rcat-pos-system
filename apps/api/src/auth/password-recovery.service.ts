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

function requireRecoveryTestMode(): void {
  // Never expose raw test recovery tokens or recovery APIs to real users.
  if (
    process.env["CI"] !== "true" ||
    process.env["NODE_ENV"] !== "test" ||
    process.env["ENABLE_RECOVERY_TEST_MODE"] !== "true" ||
    process.env["ENABLE_DEVELOPMENT_AUTH"] !== "true"
  ) {
    throw new ServiceUnavailableException("Password recovery is disabled");
  }
}

@Injectable()
export class PasswordRecoveryService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly mail: EmailDeliveryService,
  ) {}

  async request(raw: unknown): Promise<{
    status: "if_account_exists";
    testRecoveryToken?: string;
  }> {
    requireRecoveryTestMode();
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new BadRequestException("Invalid request");
    }
    let email: string;
    try {
      email = normalizeRegistrationEmail(
        (raw as Record<string, unknown>)["email"],
      );
    } catch {
      throw new BadRequestException("Invalid request");
    }
    const token = newOpaqueSecret();
    const digest = digestOpaqueSecret(token);
    const result = await this.database.auth((client) =>
      client.query<{ accepted: boolean }>(
        "SELECT rcat_private.request_password_recovery($1,$2) AS accepted",
        [email, digest],
      ),
    );
    if (result.rows[0]?.accepted) {
      try {
        await this.mail.sendAction("reset-password", email, token);
      } catch {
        await this.database.auth((client) =>
          client.query(
            "SELECT rcat_private.cancel_password_recovery($1)",
            [digest],
          ),
        );
        // No account enumeration: transport failure yields generic response.
        return { status: "if_account_exists" };
      }
      // This test-only token must NEVER be returned by a public endpoint.
      return { status: "if_account_exists", testRecoveryToken: token };
    }
    return { status: "if_account_exists" };
  }

  async complete(raw: unknown): Promise<{ reset: true }> {
    requireRecoveryTestMode();
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new NotFoundException("Recovery unavailable");
    }
    const fields = raw as Record<string, unknown>;
    const token = fields["token"];
    const password = fields["newPassword"];
    if (typeof token !== "string" || typeof password !== "string") {
      throw new NotFoundException("Recovery unavailable");
    }
    let digest: Buffer;
    let encoded: string;
    try {
      digest = digestOpaqueSecret(token);
      encoded = await hashPassword(password);
    } catch {
      throw new BadRequestException("Invalid recovery details");
    }
    try {
      await this.database.auth((client) =>
        client.query(
          "SELECT rcat_private.complete_password_recovery($1,$2)",
          [digest, encoded],
        ),
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: unknown }).code
          : undefined;
      if (code === "42501" || code === "23505") {
        throw new NotFoundException("Recovery unavailable");
      }
      throw error;
    }
    return { reset: true };
  }
}
