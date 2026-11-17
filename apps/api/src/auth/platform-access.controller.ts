import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { DatabaseAccess } from "../database/db-access";
import { AuthService } from "./auth.service";
import { ApiRequest, requireAllowedOrigin } from "./request-security";

const RCAT_EMAIL = /^[^\s@]+@rcat\.ac\.th$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function emailOf(body: Record<string, unknown>): string {
  const input = body["email"];
  if (typeof input !== "string") throw new BadRequestException("Invalid address");
  const email = input.trim().toLowerCase();
  if (!RCAT_EMAIL.test(email) || email.length > 254) {
    throw new BadRequestException("Only approved @rcat.ac.th accounts");
  }
  return email;
}

function objectOf(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Invalid input");
  }
  return body as Record<string, unknown>;
}

function platformError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000") {
    throw new ForbiddenException("Platform access denied");
  }
  if (code === "22023" || code === "23514") {
    throw new BadRequestException("Invalid platform access operation");
  }
  if (code === "23505") throw new ConflictException("Account conflict");
  throw error;
}

@Controller("platform")
export class PlatformAccessController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseAccess,
  ) {}

  @Get("accounts")
  @Header("Cache-Control", "no-store")
  async accounts(@Req() req: ApiRequest) {
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          user_id: string;
          email: string;
          role: "super_admin" | "admin" | "merchant";
          is_active: boolean;
        }>("SELECT * FROM rcat_private.list_platform_accounts($1)", [
          digestOpaqueSecret(session.token),
        ]),
      );
      return {
        accounts: result.rows.map((x) => ({
          userId: x.user_id,
          email: x.email,
          role: x.role,
          active: x.is_active,
        })),
      };
    } catch (error) {
      platformError(error);
    }
  }

  @Get("tenants")
  @Header("Cache-Control", "no-store")
  async tenants(@Req() req: ApiRequest) {
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          tenant_id: string;
          tenant_name: string;
          store_count: string;
        }>("SELECT * FROM rcat_private.list_platform_tenants($1)", [
          digestOpaqueSecret(session.token),
        ]),
      );
      return {
        tenants: result.rows.map((x) => ({
          tenantId: x.tenant_id,
          tenantName: x.tenant_name,
          storeCount: Number(x.store_count),
        })),
      };
    } catch (error) {
      platformError(error);
    }
  }

  @Post("accounts")
  @Header("Cache-Control", "no-store")
  async grant(@Req() req: ApiRequest, @Body() raw: unknown) {
    requireAllowedOrigin(req);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const body = objectOf(raw);
    const email = emailOf(body);
    const role = body["role"];
    const active = body["active"];
    if (
      (role !== "admin" && role !== "merchant") ||
      typeof active !== "boolean"
    ) {
      throw new BadRequestException("Invalid platform role");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ user_id: string }>(
          "SELECT rcat_private.manage_platform_account($1,$2,$3,$4) AS user_id",
          [digestOpaqueSecret(session.token), email, role, active],
        ),
      );
      return { userId: result.rows[0]?.user_id, role, active };
    } catch (error) {
      platformError(error);
    }
  }

  @Post("tenants/:tenantId/merchants")
  @Header("Cache-Control", "no-store")
  async assignMerchant(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Body() raw: unknown,
  ) {
    requireAllowedOrigin(req);
    if (!UUID.test(tenantId)) throw new NotFoundException("Tenant unavailable");
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const email = emailOf(objectOf(raw));
    try {
      const result = await this.database.auth((client) =>
        client.query<{ user_id: string }>(
          "SELECT rcat_private.assign_platform_merchant($1,$2,$3) AS user_id",
          [digestOpaqueSecret(session.token), email, tenantId],
        ),
      );
      return { userId: result.rows[0]?.user_id, tenantId, role: "owner" };
    } catch (error) {
      platformError(error);
    }
  }

  @Post("tenants/:tenantId/enter")
  @Header("Cache-Control", "no-store")
  async enterTenant(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
  ) {
    requireAllowedOrigin(req);
    if (!UUID.test(tenantId)) throw new NotFoundException("Tenant unavailable");
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    try {
      await this.database.auth((client) =>
        client.query(
          "SELECT rcat_private.super_admin_enter_tenant($1,$2)",
          [digestOpaqueSecret(session.token), tenantId],
        ),
      );
      return { tenantId, role: "owner" };
    } catch (error) {
      platformError(error);
    }
  }
}
