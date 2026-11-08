import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateIds(tenantId: string, storeId: string): void {
  if (!UUID.test(tenantId) || !UUID.test(storeId)) {
    throw new NotFoundException("Catalog unavailable");
  }
}

function bodyObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Invalid catalog data");
  }
  return raw as Record<string, unknown>;
}

function nameField(raw: unknown, maxLength: number): string {
  if (
    typeof raw !== "string" ||
    raw.trim().length < 1 ||
    raw.trim().length > maxLength
  ) {
    throw new BadRequestException("Invalid name");
  }
  return raw.trim();
}

function slugField(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length < 3 ||
    raw.length > 48 ||
    !SLUG.test(raw)
  ) {
    throw new BadRequestException("Invalid category slug");
  }
  return raw;
}

function mapping(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000" || code === "23503") {
    throw new NotFoundException("Catalog unavailable");
  }
  if (code === "P0009") {
    throw new ConflictException(
      "Product was updated or archived; refresh catalog",
    );
  }
  if (code === "23505") {
    throw new ConflictException("Catalog item already exists");
  }
  if (code === "23514" || code === "22023" || code === "22P02") {
    throw new BadRequestException("Invalid catalog data");
  }
  throw error;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async snapshot(req: ApiRequest, tenantId: string, storeId: string) {
    validateIds(tenantId, storeId);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{
          snapshot: { categories: unknown[]; products: unknown[] };
        }>("SELECT rcat_private.catalog_snapshot($1,$2,$3) AS snapshot", [
          digestOpaqueSecret(session.token),
          tenantId,
          storeId,
        ]),
      );
      return result.rows[0]?.snapshot ?? { categories: [], products: [] };
    } catch (error) {
      mapping(error);
    }
  }

  async page(req: ApiRequest, tenantId: string, storeId: string, raw: unknown) {
    validateIds(tenantId, storeId);
    const session = await this.auth.session(req);
    const data = bodyObject(raw);
    const search = data["search"] ?? "";
    const categoryId = data["categoryId"] ?? null;
    const includeArchived = data["includeArchived"] ?? "false";
    const cursorCreatedAt = data["cursorCreatedAt"] ?? null;
    const cursorId = data["cursorId"] ?? null;
    const limit = data["limit"] ?? "20";
    if (
      typeof search !== "string" ||
      search.trim().length > 80 ||
      (categoryId !== null &&
        (typeof categoryId !== "string" || !UUID.test(categoryId))) ||
      (includeArchived !== "true" && includeArchived !== "false") ||
      typeof limit !== "string" ||
      !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit) ||
      (cursorCreatedAt === null) !== (cursorId === null) ||
      (cursorId !== null &&
        (typeof cursorId !== "string" || !UUID.test(cursorId))) ||
      (cursorCreatedAt !== null &&
        (typeof cursorCreatedAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
            cursorCreatedAt,
          ) ||
          !Number.isFinite(Date.parse(cursorCreatedAt))))
    ) {
      throw new BadRequestException("Invalid catalog page request");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.catalog_products_page($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            search.trim(),
            categoryId,
            includeArchived === "true",
            cursorCreatedAt,
            cursorId,
            Number(limit),
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapping(error);
    }
  }

  async addCategory(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = bodyObject(raw);
    const slug = slugField(data["slug"]);
    const name = nameField(data["name"], 120);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ id: string }>(
          "SELECT rcat_private.add_menu_category($1,$2,$3,$4,$5) AS id",
          [digestOpaqueSecret(session.token), tenantId, storeId, slug, name],
        ),
      );
      return { categoryId: result.rows[0]?.id };
    } catch (error) {
      mapping(error);
    }
  }

  async addProduct(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = bodyObject(raw);
    const name = nameField(data["name"], 160);
    const categoryId = data["categoryId"];
    const priceSatang = data["priceSatang"];
    if (
      typeof categoryId !== "string" ||
      !UUID.test(categoryId) ||
      typeof priceSatang !== "number" ||
      !Number.isSafeInteger(priceSatang) ||
      priceSatang < 1 ||
      priceSatang > 100000000
    ) {
      throw new BadRequestException("Invalid product or price");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ id: string }>(
          "SELECT rcat_private.add_menu_product($1,$2,$3,$4,$5,$6) AS id",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            categoryId,
            name,
            priceSatang,
          ],
        ),
      );
      return { productId: result.rows[0]?.id };
    } catch (error) {
      mapping(error);
    }
  }

  async updateProduct(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    productId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId);
    if (!UUID.test(productId))
      throw new NotFoundException("Catalog unavailable");
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = bodyObject(raw);
    const name = nameField(data["name"], 160);
    const categoryId = data["categoryId"];
    const priceSatang = data["priceSatang"];
    const expectedRevision = data["expectedRevision"];
    if (
      typeof categoryId !== "string" ||
      !UUID.test(categoryId) ||
      typeof priceSatang !== "number" ||
      !Number.isSafeInteger(priceSatang) ||
      priceSatang < 1 ||
      priceSatang > 100000000 ||
      typeof expectedRevision !== "number" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      throw new BadRequestException("Invalid catalog product edit");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.update_menu_product($1,$2,$3,$4,$5,$6,$7,$8) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            productId,
            expectedRevision,
            name,
            categoryId,
            priceSatang,
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapping(error);
    }
  }

  async archiveProduct(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    productId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId);
    if (!UUID.test(productId))
      throw new NotFoundException("Catalog unavailable");
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = bodyObject(raw);
    const expectedRevision = data["expectedRevision"];
    if (
      typeof expectedRevision !== "number" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      throw new BadRequestException("Invalid catalog archive request");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: Record<string, unknown> }>(
          "SELECT rcat_private.archive_menu_product($1,$2,$3,$4,$5) AS data",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            productId,
            expectedRevision,
          ],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mapping(error);
    }
  }

  async availability(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    productId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId);
    if (!UUID.test(productId))
      throw new NotFoundException("Catalog unavailable");
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = bodyObject(raw);
    if (typeof data["available"] !== "boolean") {
      throw new BadRequestException("Invalid availability");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ available: boolean }>(
          "SELECT rcat_private.set_menu_product_availability($1,$2,$3,$4,$5) AS available",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            productId,
            data["available"],
          ],
        ),
      );
      return { productId, available: result.rows[0]?.available };
    } catch (error) {
      mapping(error);
    }
  }
}
