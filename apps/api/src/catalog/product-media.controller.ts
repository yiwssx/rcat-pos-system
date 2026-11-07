import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
  Req,
  Res,
  Body,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { ProductMediaService } from "./product-media.service";

function sendWebp(
  res: ServerResponse,
  data: {
    webp: Buffer;
    digest_sha256: Buffer;
  },
): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", data.webp.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("ETag", '"' + data.digest_sha256.toString("hex") + '"');
  res.end(data.webp);
}

@Controller()
export class ProductMediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Put("tenants/:tenantId/stores/:storeId/catalog/products/:productId/image")
  @Header("Cache-Control", "no-store")
  put(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("productId") product: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    requireAllowedOrigin(req);
    // CI-only diagnostic: format metadata only, never image bytes, URLs,
    // cookies or identities. Removed after validating the upload parser.
    if (process.env["CI"] === "true" &&
        process.env["PGDATABASE"] === "rcat_ci_test") {
      const value = Buffer.isBuffer(raw) ? raw : null;
      res.setHeader("X-G2-CI-Format", [
        value ? "buffer" : (raw === undefined ? "undefined" : typeof raw),
        value?.length ?? 0,
        value && value.length >= 20 ? value.toString("ascii", 12, 16) : "?",
        value && value.length >= 8 ? value.readUInt32LE(4) + 8 : 0,
      ].join("|"));
    }
    return this.media.put(req, tenant, store, product, raw);
  }

  @Delete("tenants/:tenantId/stores/:storeId/catalog/products/:productId/image")
  @Header("Cache-Control", "no-store")
  remove(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("productId") product: string,
  ) {
    requireAllowedOrigin(req);
    return this.media.remove(req, tenant, store, product);
  }

  @Get("tenants/:tenantId/stores/:storeId/catalog/products/:productId/image")
  async staffRead(
    @Req() req: ApiRequest,
    @Res() res: ServerResponse,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("productId") product: string,
  ) {
    const data = await this.media.readStaff(req, tenant, store, product);
    sendWebp(res, data);
  }

  // UUIDs are public catalog references, not secrets. Public delivery is
  // only allowed for currently available and unarchived menu products.
  @Get("guest/catalog-media/:tenantId/:storeId/:productId")
  async guestRead(
    @Res() res: ServerResponse,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("productId") product: string,
  ) {
    const data = await this.media.readGuest(tenant, store, product);
    sendWebp(res, data);
  }
}
