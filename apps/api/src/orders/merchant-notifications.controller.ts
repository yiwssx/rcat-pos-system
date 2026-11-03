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
import { MerchantNotificationsService } from "./merchant-notifications.service";

@Controller("tenants/:tenantId/stores/:storeId/notifications")
export class MerchantNotificationsController {
  constructor(private readonly notifications: MerchantNotificationsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Query("after") after: unknown,
    @Query("limit") limit: unknown,
  ) {
    return this.notifications.list(req, tenantId, storeId, after, limit);
  }

  @Post("ack")
  @Header("Cache-Control", "no-store")
  acknowledge(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.notifications.acknowledge(req, tenantId, storeId, body);
  }
}
