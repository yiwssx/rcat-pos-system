import { Controller, Header, Param, Post, Req } from "@nestjs/common";
import {
  ApiRequest,
  header,
  requireAllowedOrigin,
} from "../auth/request-security";
import { GuestPaymentRequestService } from "./guest-payment-request.service";

/**
 * Checkout remains unconditional: this optional, independent endpoint is
 * called only AFTER successful Order creation, by its tracking capability.
 */
@Controller("guest/orders/:orderId/payment-request")
export class GuestPaymentRequestController {
  constructor(private readonly payments: GuestPaymentRequestService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  request(@Req() req: ApiRequest, @Param("orderId") orderId: string) {
    requireAllowedOrigin(req);
    return this.payments.request(req, orderId, header(req, "authorization"));
  }
}
