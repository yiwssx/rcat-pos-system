import {
  Body,
  Controller,
  Delete,
  Header,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { PaymentRecoveryService } from "./payment-recovery.service";

@Controller()
export class PaymentRecoveryController {
  constructor(private readonly recovery: PaymentRecoveryService) {}

  @Post("tenants/:tenantId/stores/:storeId/orders/:orderId/payment-recovery")
  @Header("Cache-Control", "no-store")
  issue(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("orderId") order: string,
    @Body() raw: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.recovery.issue(req, tenant, store, order, raw);
  }

  @Delete("tenants/:tenantId/stores/:storeId/orders/:orderId/payment-recovery")
  @Header("Cache-Control", "no-store")
  revoke(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("orderId") order: string,
  ) {
    requireAllowedOrigin(req);
    return this.recovery.revoke(req, tenant, store, order);
  }

  @Post("guest/orders/:orderId/payment-recovery/redeem")
  @Header("Cache-Control", "no-store")
  redeem(
    @Req() req: ApiRequest,
    @Param("orderId") order: string,
    @Body() raw: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.recovery.redeem(req, order, raw);
  }
}
