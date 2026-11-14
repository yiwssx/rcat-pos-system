import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { PaymentSlipService } from "./payment-slip.service";

@Controller()
export class PaymentSlipController {
  constructor(private readonly slips: PaymentSlipService) {}

  @Put("guest/orders/:orderId/payment-slip")
  @Header("Cache-Control", "no-store")
  submitGuest(
    @Req() req: ApiRequest,
    @Param("orderId") orderId: string,
    @Body() raw: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.slips.submitGuest(req, orderId, raw);
  }

  @Get("tenants/:tenantId/stores/:storeId/payments/slips")
  @Header("Cache-Control", "no-store")
  queue(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
  ) {
    return this.slips.queue(req, tenant, store);
  }

  @Get("tenants/:tenantId/stores/:storeId/payments/slips/:slipId/image")
  async privateImage(
    @Req() req: ApiRequest,
    @Res() res: ServerResponse,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("slipId") slip: string,
  ) {
    const evidence = await this.slips.privatePng(req, tenant, store, slip);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", evidence.png.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.end(evidence.png);
  }

  @Post("tenants/:tenantId/stores/:storeId/payments/slips/:slipId/decision")
  @Header("Cache-Control", "no-store")
  decide(
    @Req() req: ApiRequest,
    @Param("tenantId") tenant: string,
    @Param("storeId") store: string,
    @Param("slipId") slip: string,
    @Body() raw: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.slips.decide(req, tenant, store, slip, raw);
  }
}
