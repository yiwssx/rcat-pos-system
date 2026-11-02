import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret, newOpaqueSecret } from "../../../../libs/server-auth/src";
import { DatabaseAccess } from "../database/db-access";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";

interface MerchantForm {
  tenantSlug: string;
  tenantName: string;
  storeSlug: string;
  storeName: string;
}
interface InvitationForm {
  email: string;
  role: "manager" | "cashier" | "kitchen";
}
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

function inputObject(raw: unknown): Record<string, unknown> {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    throw new BadRequestException("Invalid request");
  }
  return raw as Record<string, unknown>;
}

function merchantForm(raw: unknown): MerchantForm {
  const body = inputObject(raw);
  const tenantSlug = body["tenantSlug"];
  const storeSlug = body["storeSlug"];
  const tenantName = body["tenantName"];
  const storeName = body["storeName"];
  if (
    typeof tenantSlug !== "string" ||
    typeof storeSlug !== "string" ||
    !SLUG.test(tenantSlug) ||
    !SLUG.test(storeSlug) ||
    tenantSlug.length < 3 ||
    tenantSlug.length > 48 ||
    storeSlug.length < 3 ||
    storeSlug.length > 48 ||
    typeof tenantName !== "string" ||
    typeof storeName !== "string" ||
    tenantName.trim().length < 1 ||
    tenantName.trim().length > 160 ||
    storeName.trim().length < 1 ||
    storeName.trim().length > 160
  ) {
    throw new BadRequestException("Invalid merchant details");
  }
  return { tenantSlug, tenantName, storeSlug, storeName };
}

function inviteForm(raw: unknown): InvitationForm {
  const body = inputObject(raw);
  const email = body["email"];
  const role = body["role"];
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (role !== "manager" && role !== "cashier" && role !== "kitchen")
  ) {
    throw new BadRequestException("Invalid invitation");
  }
  return { email: email.trim().toLowerCase(), role };
}

function mapDbError(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code: unknown }).code
    : undefined;
  if (code === "23505") throw new ConflictException("Resource already exists");
  if (code === "22023" || code === "23514") {
    throw new BadRequestException("Request cannot be processed");
  }
  if (code === "42501" || code === "28000") {
    throw new NotFoundException("Resource unavailable");
  }
  throw error;
}

@Injectable()
export class MerchantOnboardingService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async create(req: ApiRequest, raw: unknown) {
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const form = merchantForm(raw);
    try {
      const { rows } = await this.database.auth((client) =>
        client.query<{ tenant_id: string; store_id: string }>(
          "SELECT * FROM rcat_private.create_merchant_for_session($1,$2,$3,$4,$5)",
          [
            digestOpaqueSecret(session.token),
            form.tenantSlug,
            form.tenantName,
            form.storeSlug,
            form.storeName,
          ],
        ),
      );
      const row = rows[0];
      if (!row) throw new Error("Tenant creation returned no result");
      return { tenantId: row.tenant_id, storeId: row.store_id, role: "owner" };
    } catch (error) {
      mapDbError(error);
    }
  }

  async invite(req: ApiRequest, tenantId: string, raw: unknown) {
    if (!UUID.test(tenantId)) throw new NotFoundException();
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const form = inviteForm(raw);
    const token = newOpaqueSecret();
    try {
      const { rows } = await this.database.auth((client) =>
        client.query<{ id: string }>(
          "SELECT rcat_private.create_staff_invitation($1,$2,$3,$4,$5) AS id",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            form.email,
            form.role,
            digestOpaqueSecret(token),
          ],
        ),
      );
      return {
        invitationId: rows[0]?.id,
        invitationToken: token,
        expiresInHours: 72,
      };
    } catch (error) {
      mapDbError(error);
    }
  }

  async accept(req: ApiRequest, raw: unknown) {
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const body = inputObject(raw);
    const token = body["invitationToken"];
    if (typeof token !== "string") throw new NotFoundException("Invitation unavailable");
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Invitation unavailable");
    }
    try {
      const { rows } = await this.database.auth((client) =>
        client.query<{ tenant_id: string; role: string }>(
          "SELECT * FROM rcat_private.accept_staff_invitation($1,$2)",
          [digestOpaqueSecret(session.token), digest],
        ),
      );
      const record = rows[0];
      if (!record) throw new Error("Acceptance returned no record");
      return { tenantId: record.tenant_id, role: record.role };
    } catch (error) {
      mapDbError(error);
    }
  }
}
