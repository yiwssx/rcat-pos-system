import { Body, Controller, Header, HttpCode, Post, Req } from "@nestjs/common";
import {
  ApiRequest,
  header,
  requireAllowedOrigin,
} from "../auth/request-security";
import { GuestOrdersService } from "./guest-orders.service";

@Controller("guest/orders")
export class GuestOrdersController {
  constructor(private readonly orders: GuestOrdersService) {}

  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  async place(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.orders.place(body, header(req, "Idempotency-Key"));
  }
}
