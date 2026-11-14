import {
  Body, Controller, Get, Header, Param, Post, Query, Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { PaymentFinanceService } from "./payment-finance.service";

@Controller("tenants/:tenantId/stores/:storeId/payments/finance")
export class PaymentFinanceController {
  constructor(private readonly finance: PaymentFinanceService) {}

  @Get("report")
  @Header("Cache-Control", "private, no-store")
  report(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Query("days") days?: string,
  ) {
    return this.finance.report(req, tenant, store, days);
  }

  @Post("refunds")
  @Header("Cache-Control", "no-store")
  refund(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.finance.requestRefund(req, tenant, store, body);
  }

  @Post("refunds/:refundId/decision")
  @Header("Cache-Control", "no-store")
  refundDecision(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("refundId") refundId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.finance.refundDecision(req, tenant, store, refundId, body);
  }

  @Post("exceptions")
  @Header("Cache-Control", "no-store")
  exception(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.finance.createException(req, tenant, store, body);
  }

  @Post("exceptions/:exceptionId/resolve")
  @Header("Cache-Control", "no-store")
  resolve(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("exceptionId") exceptionId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.finance.resolveException(
      req, tenant, store, exceptionId, body,
    );
  }
}
