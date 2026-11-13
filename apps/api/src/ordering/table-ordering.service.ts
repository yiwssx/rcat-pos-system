import { createHmac, randomInt } from "node:crypto";
import * as QRCode from "qrcode";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
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
import { GuestRequestBudgetService } from "./guest-request-budget.service";

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
  if (code === "P0041") {
    throw new HttpException("Too many table sessions", HttpStatus.TOO_MANY_REQUESTS);
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
      !(
        process.env["CI"] === "true" &&
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      ))
  ) {
    throw new ServiceUnavailableException("Ordering URL not configured");
  }
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function printableUrl(
  tenantId: string,
  storeId: string,
  tableId: string,
): string {
  // QR has ONLY public immutable IDs. It is never a visit bearer.
  const url = new URL(orderingUrl(newOpaqueSecret()));
  url.hash = "";
  url.searchParams.set("tenant", tenantId);
  url.searchParams.set("store", storeId);
  url.searchParams.set("table", tableId);
  return url.toString();
}

function codeDigest(
  tenant: string,
  store: string,
  table: string,
  code: string,
): Buffer {
  const pepper = process.env["GUEST_TABLE_CODE_PEPPER"];
  if (!pepper || !/^[0-9a-f]{64}$/.test(pepper)) {
    throw new ServiceUnavailableException("Table code service not configured");
  }
  return createHmac("sha256", Buffer.from(pepper, "hex"))
    .update(
      "rcat-pos-table-code-v1\0" +
        tenant +
        "\0" +
        store +
        "\0" +
        table +
        "\0" +
        code,
    )
    .digest();
}

@Injectable()
export class TableOrderingService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
    private readonly guestBudget: GuestRequestBudgetService,
  ) {}

  async create(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    ids(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const label = requestObject(raw)["label"];
    if (
      typeof label !== "string" ||
      label.trim().length < 1 ||
      label.trim().length > 60
    ) {
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

  async tables(req: ApiRequest, tenantId: string, storeId: string) {
    ids(tenantId, storeId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          data: {
            orderingEnabled: boolean;
            tables: Array<{
              tableId: string;
              label: string;
              active: boolean;
              codeExpiresAt: string | null;
            }>;
          };
        }>("SELECT rcat_private.list_printable_tables($1,$2,$3) AS data", [
          digestOpaqueSecret(session.token),
          tenantId,
          storeId,
        ]),
      );
      const tables = result.rows[0]?.data?.tables ?? [];
      return {
        orderingEnabled: result.rows[0]?.data?.orderingEnabled === true,
        tables: tables.map((table) => ({
          ...table,
          printedUrl: printableUrl(tenantId, storeId, table.tableId),
        })),
      };
    } catch (error) {
      safeError(error);
    }
  }

  async printQr(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    tableId: string,
  ): Promise<string> {
    ids(tenantId, storeId, tableId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { tableId: string; label: string } }>(
          "SELECT rcat_private.printable_table_detail($1,$2,$3,$4) AS data",
          [digestOpaqueSecret(session.token), tenantId, storeId, tableId],
        ),
      );
      if (!result.rows[0]?.data)
        throw new NotFoundException("Table unavailable");
      return QRCode.toString(printableUrl(tenantId, storeId, tableId), {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 4,
        width: 512,
      });
    } catch (error) {
      safeError(error);
    }
  }

  async issueCode(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    tableId: string,
  ) {
    ids(tenantId, storeId, tableId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    // A new staff-issued code revokes the previous visit and all guest grants.
    const code = randomInt(0, 100000000).toString().padStart(8, "0");
    const secret = newOpaqueSecret();
    const digest = codeDigest(tenantId, storeId, tableId, code);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { visitId: string; expiresAt: string } }>(
          "SELECT rcat_private.issue_table_code($1,$2,$3,$4,$5,$6) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            tableId,
            digestOpaqueSecret(secret),
            digest,
          ],
        ),
      );
      const data = result.rows[0]?.data;
      if (!data) throw new NotFoundException("Table unavailable");
      return {
        ...data,
        code,
        expiresAt: data.expiresAt,
        printedUrl: printableUrl(tenantId, storeId, tableId),
      };
    } catch (error) {
      safeError(error);
    }
  }

  async setOrderingState(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    ids(tenantId, storeId);
    const input = requestObject(raw);
    if (Object.keys(input).length !== 1 || typeof input["enabled"] !== "boolean") {
      throw new BadRequestException("Invalid ordering state");
    }
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ enabled: boolean }>(
          "SELECT rcat_private.set_store_ordering_enabled($1,$2,$3,$4) AS enabled",
          [digestOpaqueSecret(session.token), tenantId, storeId, input["enabled"]],
        ),
      );
      return { orderingEnabled: result.rows[0]?.enabled === true };
    } catch (error) {
      safeError(error);
    }
  }

  async openPrintedTable(req: ApiRequest, raw: unknown) {
    const input = requestObject(raw);
    const tenant = input["tenantId"];
    const store = input["storeId"];
    const table = input["tableId"];
    if (
      Object.keys(input).length !== 3 ||
      typeof tenant !== "string" || typeof store !== "string" ||
      typeof table !== "string" ||
      !UUID.test(tenant) || !UUID.test(store) || !UUID.test(table)
    ) {
      throw new NotFoundException("Table unavailable");
    }
    await this.guestBudget.consume(req, "redeem", table);
    const guestToken = newOpaqueSecret();
    const masterToken = newOpaqueSecret();
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: {
          open: boolean;
          storeName: string;
          tableLabel: string;
          expiresAt?: string;
        } }>(
          "SELECT rcat_private.open_printed_ordering_table($1,$2,$3,$4,$5) AS data",
          [
            tenant, store, table,
            digestOpaqueSecret(masterToken),
            digestOpaqueSecret(guestToken),
          ],
        ),
      );
      const state = result.rows[0]?.data;
      if (!state) throw new NotFoundException("Table unavailable");
      return state.open ? { ...state, visitToken: guestToken } : state;
    } catch (error) {
      safeError(error);
    }
  }

  async redeemCode(req: ApiRequest, raw: unknown) {
    const input = requestObject(raw);
    const tenant = input["tenantId"],
      store = input["storeId"];
    const table = input["tableId"],
      code = input["code"];
    if (
      typeof tenant !== "string" ||
      typeof store !== "string" ||
      typeof table !== "string" ||
      typeof code !== "string" ||
      !UUID.test(tenant) ||
      !UUID.test(store) ||
      !UUID.test(table) ||
      !/^[0-9]{8}$/.test(code)
    ) {
      throw new NotFoundException("Ordering code unavailable");
    }
    await this.guestBudget.consume(req, "redeem", table);
    const token = newOpaqueSecret();
    const digest = codeDigest(tenant, store, table, code);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { ok: boolean; expiresAt?: string } }>(
          "SELECT rcat_private.redeem_table_code($1,$2,$3,$4,$5) AS data",
          [tenant, store, table, digest, digestOpaqueSecret(token)],
        ),
      );
      if (!result.rows[0]?.data?.ok)
        throw new NotFoundException("Ordering code unavailable");
      return { visitToken: token, expiresAt: result.rows[0].data.expiresAt };
    } catch (error) {
      safeError(error);
    }
  }

  async resolve(req: ApiRequest, raw: unknown) {
    const token = requestObject(raw)["token"];
    if (typeof token !== "string") {
      throw new NotFoundException("Ordering visit unavailable");
    }
    await this.guestBudget.consume(req, "resolve", token);
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

  async reviewCart(req: ApiRequest, raw: unknown) {
    const data = requestObject(raw);
    const token = data["token"];
    const items = data["items"];
    if (
      typeof token !== "string" ||
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > 20
    ) {
      throw new BadRequestException("Invalid Guest cart review");
    }
    const products = new Set<string>();
    const options = new Set<string>();
    let quantity = 0;
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new BadRequestException("Invalid Guest cart review");
      }
      const line = rawItem as Record<string, unknown>;
      if (
        typeof line["productId"] !== "string" ||
        !UUID.test(line["productId"]) ||
        !Array.isArray(line["optionIds"]) ||
        line["optionIds"].length > 32 ||
        line["optionIds"].some(
          (id: unknown) => typeof id !== "string" || !UUID.test(id),
        ) ||
        typeof line["quantity"] !== "number" ||
        !Number.isInteger(line["quantity"]) ||
        line["quantity"] < 1 ||
        line["quantity"] > 20
      ) {
        throw new BadRequestException("Invalid Guest cart review");
      }
      const ids = (line["optionIds"] as string[]).map((id) => id.toLowerCase());
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException("Duplicate modifiers");
      }
      products.add(line["productId"].toLowerCase());
      ids.forEach((id) => options.add(id));
      quantity += line["quantity"];
    }
    if (quantity > 100) {
      throw new BadRequestException("Too many items");
    }
    await this.guestBudget.consume(req, "resolve", token);
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Ordering visit unavailable");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.guest_cart_review($1,$2::uuid[],$3::uuid[]) AS data",
          [digest, [...products], [...options]],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      safeError(error);
    }
  }

  async page(req: ApiRequest, raw: unknown) {
    const data = requestObject(raw);
    const token = data["token"];
    if (typeof token !== "string") {
      throw new NotFoundException("Ordering visit unavailable");
    }
    const search = data["search"] ?? "";
    const categoryId = data["categoryId"] ?? null;
    const limit = data["limit"] ?? 24;
    const cursor = data["cursor"] ?? null;
    if (
      typeof search !== "string" ||
      search.trim().length > 80 ||
      (categoryId !== null &&
        (typeof categoryId !== "string" || !UUID.test(categoryId))) ||
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (cursor !== null &&
        (typeof cursor !== "object" ||
          Array.isArray(cursor) ||
          typeof (cursor as Record<string, unknown>)["createdAt"] !==
            "string" ||
          typeof (cursor as Record<string, unknown>)["id"] !== "string" ||
          !UUID.test((cursor as { id: string }).id) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
            (cursor as { createdAt: string }).createdAt,
          ) ||
          !Number.isFinite(
            Date.parse((cursor as { createdAt: string }).createdAt),
          )))
    ) {
      throw new BadRequestException("Invalid guest catalog page request");
    }
    await this.guestBudget.consume(req, "page", token);
    let digest: Buffer;
    try {
      digest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Ordering visit unavailable");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.guest_catalog_page($1,$2,$3,$4,$5,$6) AS data",
          [
            digest,
            search.trim(),
            categoryId,
            cursor ? (cursor as { createdAt: string }).createdAt : null,
            cursor ? (cursor as { id: string }).id : null,
            limit,
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      safeError(error);
    }
  }
}
