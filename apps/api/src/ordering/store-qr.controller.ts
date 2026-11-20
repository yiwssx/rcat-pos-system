import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { StoreQrService } from "./store-qr.service";

@Controller()
export class StoreQrController {
  constructor(private readonly storeQr: StoreQrService) {}

  @Get("tenants/:tenantId/stores/:storeId/store-qr")
  @Header("Cache-Control", "no-store")
  snapshot(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.storeQr.snapshot(req, tenantId, storeId);
  }

  @Post("tenants/:tenantId/stores/:storeId/store-qr/rotate")
  @Header("Cache-Control", "no-store")
  rotate(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    requireAllowedOrigin(req);
    return this.storeQr.rotate(req, tenantId, storeId);
  }

  @Get("tenants/:tenantId/stores/:storeId/store-qr/print-qr.svg")
  async printQr(
    @Req() req: ApiRequest,
    @Res() res: ServerResponse,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    const svg = await this.storeQr.printQr(req, tenantId, storeId);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.end(svg);
  }

  @Post("guest/ordering-store/open")
  @Header("Cache-Control", "no-store")
  open(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.storeQr.open(req, body);
  }

  @Post("guest/ordering-store/resolve")
  @Header("Cache-Control", "no-store")
  resolve(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.storeQr.resolve(req, body);
  }
}
