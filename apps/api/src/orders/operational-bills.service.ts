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

function validateIds(...ids: string[]): void {
  if (ids.some((id) => !UUID.test(id))) {
    throw new NotFoundException("Bill unavailable");
  }
}

function mapFailure(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000" || code === "23503") {
    throw new NotFoundException("Bill unavailable");
  }
  if (code === "22023" || code === "22P02" || code === "23514") {
    throw new BadRequestException("Invalid Bill request");
  }
  throw error;
}

@Injectable()
export class OperationalBillsService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async create(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("Invalid Bill request");
    }
    const visitId = (raw as Record<string, unknown>)["visitId"];
    if (typeof visitId !== "string") {
      throw new BadRequestException("Invalid Bill request");
    }
    validateIds(visitId);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { billId: string; created: boolean } }>(
          "SELECT rcat_private.create_operational_bill($1,$2,$3,$4) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, visitId],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapFailure(error);
    }
  }

  async snapshot(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    billId: string,
    rawLimit: unknown,
  ) {
    validateIds(tenantId, storeId, billId);
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (
      (rawLimit !== undefined &&
        (typeof rawLimit !== "string" ||
          !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit))) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new BadRequestException("Invalid Bill limit");
    }
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.operational_bill_snapshot($1,$2,$3,$4,$5) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, billId, limit],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapFailure(error);
    }
  }
}
