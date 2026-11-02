import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  digestOpaqueSecret,
  newOpaqueSecret,
} from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(...values: string[]): void {
  if (values.some((value) => !UUID.test(value))) {
    throw new NotFoundException("Table unavailable");
  }
}

function requestObject(raw: unknown): Record<string, unknown> {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    throw new BadRequestException("Invalid ordering request");
  }
  return raw as Record<string, unknown>;
}

function safeError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000" || code === "23503") {
    throw new NotFoundException("Table or visit unavailable");
  }
  if (code === "23505") {
    throw new ConflictException("Table label already exists");
  }
  if (code === "22023" || code === "23514" || code === "22P02") {
    throw new BadRequestException("Invalid ordering request");
  }
  throw error;
}

/** The token stays in the URL fragment, never the request URL or referrer. */
function orderingUrl(token: string): string {
  const configured = process.env["GUEST_ORDER_BASE_URL"];
  if (!configured) {
    throw new ServiceUnavailableException("Ordering URL not configured");
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ServiceUnavailableException("Ordering URL not configured");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" &&
      !(process.env["CI"] === "true" &&
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost")))
  ) {
    throw new ServiceUnavailableException("Ordering URL not configured");
  }
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

@Injectable()
export class TableOrderingService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async create(req: ApiRequest, tenantId: string, storeId: string, raw: unknown) {
    ids(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const label = requestObject(raw)["label"];
    if (typeof label !== "string" || label.trim().length < 1 || label.trim().length > 60) {
      throw new BadRequestException("Invalid table label");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ id: string }>(
          "SELECT rcat_private.create_ordering_table($1,$2,$3,$4) AS id",
          [digestOpaqueSecret(session.token), tenantId, storeId, label.trim()],
        ),
      );
      return { tableId: result.rows[0]?.id };
    } catch (error) {
      safeError(error);
    }
  }

  async rotate(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    tableId: string,
  ) {
    ids(tenantId, storeId, tableId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const secret = newOpaqueSecret();
    // Validate the trusted URL BEFORE changing the current table visit.
    const url = orderingUrl(secret);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ visit_id: string; expires_at: Date }>(
          "SELECT * FROM rcat_private.rotate_ordering_visit($1,$2,$3,$4,$5)",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            tableId,
            digestOpaqueSecret(secret),
          ],
        ),
      );
      const current = result.rows[0];
      if (!current) throw new Error("Ordering visit was not created");
      return {
        visitId: current.visit_id,
        expiresAt: current.expires_at,
        orderingUrl: url,
      };
    } catch (error) {
      safeError(error);
    }
  }

  async resolve(raw: unknown) {
    const token = requestObject(raw)["token"];
    if (typeof token !== "string") {
      throw new NotFoundException("Ordering visit unavailable");
    }
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Ordering visit unavailable");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.resolve_ordering_visit($1) AS data",
          [digest],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      safeError(error);
    }
  }
}
