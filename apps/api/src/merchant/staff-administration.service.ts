import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type StaffRole = "owner" | "manager" | "cashier" | "kitchen";

function validId(value: string): void {
  if (!UUID.test(value)) throw new NotFoundException("Staff unavailable");
}

function mappedError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000") {
    throw new NotFoundException("Staff unavailable");
  }
  if (code === "22023") {
    throw new BadRequestException("Invalid staff operation");
  }
  throw error;
}

@Injectable()
export class StaffAdministrationService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async list(req: ApiRequest, tenantId: string) {
    validId(tenantId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ user_id: string; role: StaffRole }>(
          "SELECT * FROM rcat_private.list_tenant_staff($1,$2)",
          [digestOpaqueSecret(session.token), tenantId],
        ),
      );
      return { tenantId, staff: result.rows };
    } catch (error) {
      mappedError(error);
    }
  }

  async changeRole(
    req: ApiRequest,
    tenantId: string,
    userId: string,
    raw: unknown,
  ) {
    validId(tenantId);
    validId(userId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new BadRequestException("Invalid staff role");
    }
    const role = (raw as Record<string, unknown>)["role"];
    if (role !== "manager" && role !== "cashier" && role !== "kitchen") {
      throw new BadRequestException("Invalid staff role");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ role: StaffRole }>(
          "SELECT rcat_private.manage_tenant_staff($1,$2,$3,'change_role',$4) AS role",
          [digestOpaqueSecret(session.token), tenantId, userId, role],
        ),
      );
      return { userId, role: result.rows[0]?.role };
    } catch (error) {
      mappedError(error);
    }
  }

  async remove(req: ApiRequest, tenantId: string, userId: string) {
    validId(tenantId);
    validId(userId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    try {
      await this.database.auth((client) =>
        client.query(
          "SELECT rcat_private.manage_tenant_staff($1,$2,$3,'remove',NULL)",
          [digestOpaqueSecret(session.token), tenantId, userId],
        ),
      );
    } catch (error) {
      mappedError(error);
    }
  }
}
