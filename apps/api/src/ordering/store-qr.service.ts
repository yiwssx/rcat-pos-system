import * as QRCode from "qrcode";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
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
import { GuestRequestBudgetService } from "./guest-request-budget.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identifiers(...values: string[]): void {
  if (values.some((value) => !UUID.test(value))) {
    throw new NotFoundException("Store QR unavailable");
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid Store QR request");
  }
  return value as Record<string, unknown>;
}

function failure(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : null;
  if (code === "42501" || code === "28000" || code === "23503") {
    throw new NotFoundException("Store QR unavailable");
  }
  if (code === "P0041") {
    throw new HttpException(
      "Too many Store QR sessions",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (code === "P0042" || code === "23505") {
    throw new ConflictException(
      "Store QR settings changed or session already exists",
    );
  }
  if (code === "22023" || code === "23514" || code === "22P02") {
    throw new BadRequestException("Invalid Store QR request");
  }
  throw error;
}

/** Permanent public locator. Never include a guest capability in the URL. */
function printedStoreUrl(
  tenantId: string,
  storeId: string,
  publicId: string,
): string {
  const raw = process.env["GUEST_ORDER_BASE_URL"];
  if (!raw) {
    throw new ServiceUnavailableException("Ordering URL not configured");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceUnavailableException("Ordering URL not configured");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(process.env["CI"] === "true" &&
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost")))
  ) {
    throw new ServiceUnavailableException("Ordering URL not configured");
  }
  url.searchParams.set("tenant", tenantId);
  url.searchParams.set("store", storeId);
  url.searchParams.set("counter", publicId);
  return url.toString();
}

interface StaffQr {
  publicId: string | null;
  orderingEnabled: boolean;
  serviceMode: "table" | "quick" | "hybrid";
}

interface GuestQrOpen {
  open: boolean;
  storeName: string;
  serviceMode?: string;
  guestSessionId?: string;
  expiresAt?: string;
}

@Injectable()
export class StoreQrService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
    private readonly guestBudget: GuestRequestBudgetService,
  ) {}

  async mode(req: ApiRequest, tenantId: string, storeId: string) {
    identifiers(tenantId, storeId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { serviceMode: string; revision: number } }>(
          "SELECT rcat_private.store_service_mode_snapshot($1,$2,$3) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId],
        ),
      );
      if (!result.rows[0]?.data) {
        throw new NotFoundException("Store QR unavailable");
      }
      return result.rows[0].data;
    } catch (error) {
      failure(error);
    }
  }

  async changeMode(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    identifiers(tenantId, storeId);
    const input = objectValue(raw);
    const mode = input["serviceMode"];
    const revision = input["expectedRevision"];
    if (
      Object.keys(input).length !== 2 ||
      !["table", "quick", "hybrid"].includes(mode as string) ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      throw new BadRequestException("Invalid service mode request");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.set_store_service_mode($1,$2,$3,$4,$5) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            mode,
            revision,
          ],
        ),
      );
      if (!result.rows[0]?.data) {
        throw new NotFoundException("Store QR unavailable");
      }
      return result.rows[0].data;
    } catch (error) {
      failure(error);
    }
  }

  async snapshot(req: ApiRequest, tenantId: string, storeId: string) {
    identifiers(tenantId, storeId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: StaffQr }>(
          "SELECT rcat_private.store_qr_snapshot($1,$2,$3) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId],
        ),
      );
      const qr = result.rows[0]?.data;
      if (!qr) throw new NotFoundException("Store QR unavailable");
      return {
        ...qr,
        printedUrl: qr.publicId
          ? printedStoreUrl(tenantId, storeId, qr.publicId)
          : null,
      };
    } catch (error) {
      failure(error);
    }
  }

  async rotate(req: ApiRequest, tenantId: string, storeId: string) {
    identifiers(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    // Fail before the transaction if the printing base URL is invalid.
    printedStoreUrl(tenantId, storeId, "00000000-0000-4000-8000-000000000000");
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { publicId: string; generation: number } }>(
          "SELECT rcat_private.rotate_store_qr($1,$2,$3) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId],
        ),
      );
      const qr = result.rows[0]?.data;
      if (!qr) throw new NotFoundException("Store QR unavailable");
      return {
        publicId: qr.publicId,
        printedUrl: printedStoreUrl(tenantId, storeId, qr.publicId),
      };
    } catch (error) {
      failure(error);
    }
  }

  async printQr(req: ApiRequest, tenantId: string, storeId: string) {
    const qr = await this.snapshot(req, tenantId, storeId);
    if (!qr.publicId || !qr.printedUrl) {
      throw new NotFoundException("Store QR unavailable");
    }
    return QRCode.toString(qr.printedUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
      width: 512,
    });
  }

  async open(req: ApiRequest, raw: unknown) {
    const input = objectValue(raw);
    const tenant = input["tenantId"];
    const store = input["storeId"];
    const publicId = input["publicId"];
    if (
      Object.keys(input).length !== 3 ||
      typeof tenant !== "string" ||
      typeof store !== "string" ||
      typeof publicId !== "string" ||
      !UUID.test(tenant) ||
      !UUID.test(store) ||
      !UUID.test(publicId)
    ) {
      throw new NotFoundException("Store QR unavailable");
    }
    await this.guestBudget.consume(
      req,
      "redeem",
      tenant + ":" + store + ":" + publicId,
    );
    const guestToken = newOpaqueSecret();
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: GuestQrOpen }>(
          "SELECT rcat_private.open_printed_store_qr($1,$2,$3,$4) AS data",
          [tenant, store, publicId, digestOpaqueSecret(guestToken)],
        ),
      );
      const state = result.rows[0]?.data;
      if (!state) throw new NotFoundException("Store QR unavailable");
      return state.open
        ? { ...state, guestToken }
        : state;
    } catch (error) {
      failure(error);
    }
  }

  async resolve(req: ApiRequest, raw: unknown) {
    const input = objectValue(raw);
    const token = input["guestToken"];
    if (Object.keys(input).length !== 1 || typeof token !== "string") {
      throw new NotFoundException("Store session unavailable");
    }
    await this.guestBudget.consume(req, "resolve", token);
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Store session unavailable");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.resolve_store_guest_session($1) AS data",
          [digest],
        ),
      );
      if (!result.rows[0]?.data) {
        throw new NotFoundException("Store session unavailable");
      }
      return result.rows[0].data;
    } catch (error) {
      failure(error);
    }
  }
}
