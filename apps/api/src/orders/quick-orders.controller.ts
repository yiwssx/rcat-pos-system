import { Body, Controller, Header, HttpCode, Param, Post, Req } from "@nestjs/common";
import {
  ApiRequest,
  header,
  requireAllowedOrigin,
} from "../auth/request-security";
import { QuickOrdersService } from "./quick-orders.service";

@Controller("guest/ordering-store")
export class QuickOrdersController {
  constructor(private readonly quickOrders: QuickOrdersService) {}

  @Post("orders")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  submit(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.quickOrders.submit(req, body, header(req, "Idempotency-Key"));
  }

  @Post("orders/:orderId/add-items")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  addItems(
    @Req() req: ApiRequest,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.quickOrders.submit(
      req,
      body,
      header(req, "Idempotency-Key"),
      orderId,
    );
  }

  @Post("my-orders")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  mine(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.quickOrders.mine(req, body);
  }
}
