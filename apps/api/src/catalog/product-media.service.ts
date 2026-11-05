import { createHash } from "node:crypto";
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
import { validateWebp } from "./webp-validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(...values: string[]): void {
  if (values.some((value) => !UUID.test(value)))
    throw new NotFoundException("Product image unavailable");
}

function mediaError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === "P0009")
    throw new ConflictException("Product changed; reload the catalog");
  if (code === "42501" || code === "28000" || code === "23503")
    throw new NotFoundException("Product image unavailable");
  if (code === "22023" || code === "23514" || code === "22P02")
    throw new BadRequestException("Invalid product image");
  throw error;
}

function revision(req: ApiRequest): number {
  const value = req.headers["x-expected-revision"];
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,14})$/.test(value)) {
    throw new BadRequestException("Expected catalog revision required");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException("Invalid product revision");
  }
  return parsed;
}

@Injectable()
export class ProductMediaService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly auth: AuthService,
  ) {}

  async put(
    req: ApiRequest, tenant: string, store: string, product: string, raw: unknown,
  ) {
    ids(tenant, store, product);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    if (req.headers["content-type"] !== "image/webp")
      throw new BadRequestException("WebP images only");
    const rev = revision(req);
    const { bytes, width, height } = validateWebp(raw);
    const digest = createHash("sha256").update(bytes).digest();
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { revision: number; hasImage: boolean } }>(
          "SELECT rcat_private.put_menu_product_media($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data",
          [digestOpaqueSecret(session.token),tenant,store,product,rev,bytes,digest,width,height],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mediaError(error);
    }
  }

  async remove(req: ApiRequest, tenant: string, store: string, product: string) {
    ids(tenant, store, product);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: { revision: number; hasImage: boolean } }>(
          "SELECT rcat_private.remove_menu_product_media($1,$2,$3,$4,$5) AS data",
          [digestOpaqueSecret(session.token),tenant,store,product,revision(req)],
        ),
      );
      return result.rows[0]?.data;
    } catch (error) {
      mediaError(error);
    }
  }

  async readGuest(tenant: string, store: string, product: string) {
    ids(tenant, store, product);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ webp: Buffer; digest_sha256: Buffer }>(
          "SELECT * FROM rcat_private.read_public_menu_media($1,$2,$3)",
          [tenant,store,product],
        ),
      );
      if (!result.rows[0]) throw new NotFoundException("Product image unavailable");
      return result.rows[0];
    } catch (error) {
      mediaError(error);
    }
  }

  async readStaff(req: ApiRequest, tenant: string, store: string, product: string) {
    ids(tenant, store, product);
    const session = await this.auth.session(req);
    try {
      const result = await this.database.auth((client) =>
        client.query<{ webp: Buffer; digest_sha256: Buffer }>(
          "SELECT * FROM rcat_private.read_staff_menu_media($1,$2,$3,$4)",
          [digestOpaqueSecret(session.token),tenant,store,product],
        ),
      );
      if (!result.rows[0]) throw new NotFoundException("Product image unavailable");
      return result.rows[0];
    } catch (error) {
      mediaError(error);
    }
  }
}
