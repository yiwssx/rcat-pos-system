import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { OperationalBillsService } from "./operational-bills.service";

@Controller("tenants/:tenantId/stores/:storeId/bills")
export class OperationalBillsController {
  constructor(private readonly bills: OperationalBillsService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.bills.create(req, tenantId, storeId, body);
  }

  @Get(":billId")
  @Header("Cache-Control", "no-store")
  snapshot(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("billId") billId: string,
    @Query("limit") limit: unknown,
  ) {
    return this.bills.snapshot(req, tenantId, storeId, billId, limit);
  }
}
