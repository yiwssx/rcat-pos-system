import { Body, Controller, Header, Param, Post, Req } from "@nestjs/common";
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

  @Post("guest/ordering-visit/resolve")
  @Header("Cache-Control", "no-store")
  resolve(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.ordering.resolve(body);
  }
}
