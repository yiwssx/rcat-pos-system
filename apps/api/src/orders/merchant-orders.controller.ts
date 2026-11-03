import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { MerchantOrdersService } from "./merchant-orders.service";

@Controller("tenants/:tenantId/stores/:storeId/orders")
export class MerchantOrdersController {
  constructor(private readonly orders: MerchantOrdersService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  inbox(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Query("status") status: unknown,
    @Query("limit") limit: unknown,
  ) {
    return this.orders.inbox(req, tenantId, storeId, status, limit);
  }

  @Patch(":orderId/status")
  @Header("Cache-Control", "no-store")
  transition(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.orders.transition(req, tenantId, storeId, orderId, body);
  }
}
