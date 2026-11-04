import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ServerResponse } from "node:http";
import {
  ApiRequest,
  header,
  requireAllowedOrigin,
} from "../auth/request-security";
import { MerchantNotificationsService } from "./merchant-notifications.service";
import { MerchantNotificationStreamService } from "./merchant-notification-stream.service";

@Controller("tenants/:tenantId/stores/:storeId/notifications")
export class MerchantNotificationsController {
  constructor(
    private readonly notifications: MerchantNotificationsService,
    private readonly streams: MerchantNotificationStreamService,
  ) {}

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

  @Get("stream")
  async stream(
    @Req() req: ApiRequest,
    @Res() res: ServerResponse,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ): Promise<void> {
    // Native EventSource uses cookies for same-origin requests. A supplied
    // cross-origin Origin must be explicitly allowlisted, never reflected.
    if (header(req, "origin") !== undefined) requireAllowedOrigin(req);
    return this.streams.open(req, res, tenantId, storeId);
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
