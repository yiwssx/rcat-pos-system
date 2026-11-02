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

function validateIds(...ids: string[]): void {
  if (ids.some((id) => !UUID.test(id))) {
    throw new NotFoundException("Modifier unavailable");
  }
}

function dataObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Invalid modifier request");
  }
  return raw as Record<string, unknown>;
}

function safeError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "42501" || code === "28000" || code === "23503") {
    throw new NotFoundException("Modifier unavailable");
  }
  if (code === "23505") {
    throw new ConflictException("Modifier already exists");
  }
  if (code === "22023" || code === "23514" || code === "22P02") {
    throw new BadRequestException("Invalid modifier request");
  }
  throw error;
}

function nameField(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.trim().length < 1 ||
    input.trim().length > 120
  ) {
    throw new BadRequestException("Invalid modifier name");
  }
  return input.trim();
}

@Injectable()
export class ProductModifiersService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async addGroup(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    productId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId, productId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = dataObject(raw);
    const slug = data["slug"];
    const minSelect = data["minSelect"];
    const maxSelect = data["maxSelect"];
    const name = nameField(data["name"]);
    if (
      typeof slug !== "string" ||
      slug.length < 3 ||
      slug.length > 48 ||
      !SLUG.test(slug) ||
      typeof minSelect !== "number" ||
      typeof maxSelect !== "number" ||
      !Number.isInteger(minSelect) ||
      !Number.isInteger(maxSelect) ||
      minSelect < 0 ||
      maxSelect < 1 ||
      maxSelect > 8 ||
      minSelect > maxSelect
    ) {
      throw new BadRequestException("Invalid modifier group");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ id: string }>(
          "SELECT rcat_private.add_modifier_group($1,$2,$3,$4,$5,$6,$7,$8) AS id",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            productId,
            slug,
            name,
            minSelect,
            maxSelect,
          ],
        ),
      );
      return { groupId: result.rows[0]?.id };
    } catch (error) {
      safeError(error);
    }
  }

  async addOption(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    productId: string,
    groupId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId, productId, groupId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = dataObject(raw);
    const name = nameField(data["name"]);
    const delta = data["priceDeltaSatang"];
    if (
      typeof delta !== "number" ||
      !Number.isSafeInteger(delta) ||
      Math.abs(delta) > 100000000
    ) {
      throw new BadRequestException("Invalid modifier price");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ id: string }>(
          "SELECT rcat_private.add_modifier_option($1,$2,$3,$4,$5,$6,$7) AS id",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            productId,
            groupId,
            name,
            delta,
          ],
        ),
      );
      return { optionId: result.rows[0]?.id };
    } catch (error) {
      safeError(error);
    }
  }

  async availability(
    req: ApiRequest,
    tenantId: string,
    storeId: string,
    productId: string,
    groupId: string,
    optionId: string,
    raw: unknown,
  ) {
    validateIds(tenantId, storeId, productId, groupId, optionId);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    const data = dataObject(raw);
    const available = data["available"];
    if (typeof available !== "boolean") {
      throw new BadRequestException("Invalid modifier availability");
    }
    try {
      const result = await this.database.auth((client) =>
        client.query<{ available: boolean }>(
          "SELECT rcat_private.set_modifier_option_availability($1,$2,$3,$4,$5,$6,$7) AS available",
          [
            digestOpaqueSecret(session.token),
            tenantId,
            storeId,
            productId,
            groupId,
            optionId,
            available,
          ],
        ),
      );
      return { optionId, available: result.rows[0]?.available };
    } catch (error) {
      safeError(error);
    }
  }
}
