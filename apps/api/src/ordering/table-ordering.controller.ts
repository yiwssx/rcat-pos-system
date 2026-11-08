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
import { TableOrderingService } from "./table-ordering.service";

@Controller()
export class TableOrderingController {
  constructor(private readonly ordering: TableOrderingService) {}

  @Post("tenants/:tenantId/stores/:storeId/tables")
  @Header("Cache-Control", "no-store")
  create(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.ordering.create(req, tenantId, storeId, body);
  }

  @Post("tenants/:tenantId/stores/:storeId/tables/:tableId/rotate")
  @Header("Cache-Control", "no-store")
  rotate(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("tableId") tableId: string,
  ) {
    requireAllowedOrigin(req);
    return this.ordering.rotate(req, tenantId, storeId, tableId);
  }

  @Get("tenants/:tenantId/stores/:storeId/tables")
  @Header("Cache-Control", "no-store")
  tables(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.ordering.tables(req, tenantId, storeId);
  }

  @Get("tenants/:tenantId/stores/:storeId/tables/:tableId/print-qr.svg")
  async printQr(
    @Req() req: ApiRequest,
    @Res() res: ServerResponse,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("tableId") tableId: string,
  ) {
    const svg = await this.ordering.printQr(req, tenantId, storeId, tableId);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.end(svg);
  }

  @Post("tenants/:tenantId/stores/:storeId/tables/:tableId/issue-code")
  @Header("Cache-Control", "no-store")
  issueCode(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("tableId") tableId: string,
  ) {
    requireAllowedOrigin(req);
    return this.ordering.issueCode(req, tenantId, storeId, tableId);
  }

  @Post("guest/ordering-code/redeem")
  @Header("Cache-Control", "no-store")
  redeemCode(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.ordering.redeemCode(req, body);
  }

  @Post("guest/ordering-visit/review-cart")
  @Header("Cache-Control", "no-store")
  reviewCart(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.ordering.reviewCart(req, body);
  }

  @Post("guest/ordering-visit/page")
  @Header("Cache-Control", "no-store")
  page(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.ordering.page(req, body);
  }

  @Post("guest/ordering-visit/resolve")
  @Header("Cache-Control", "no-store")
  resolve(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.ordering.resolve(req, body);
  }
}
