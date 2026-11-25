import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Put,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { MerchantPaymentReceiverService } from "./merchant-payment-receiver.service";

/**
 * Merchant-only receiving configuration. A configured recipient is NOT an
 * approved live Payment receiver. Activation requires signed operator approval
 * pinned to the exact revision plus live payment release flags.
 */
@Controller("tenants/:tenantId/stores/:storeId/payments/receiver")
export class MerchantPaymentReceiverController {
  constructor(private readonly receiver: MerchantPaymentReceiverService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  settings(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
  ) {
    return this.receiver.settings(req, tenantId, storeId);
  }

  @Put()
  @Header("Cache-Control", "no-store")
  configure(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.receiver.configure(req, tenantId, storeId, body);
  }

  @Patch("activation")
  @Header("Cache-Control", "no-store")
  activation(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.receiver.activation(req, tenantId, storeId, body);
  }
}
