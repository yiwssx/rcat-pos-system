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
import { PlatformPaymentApprovalService } from "./platform-payment-approval.service";

@Controller("platform/payments")
export class PlatformPaymentApprovalController {
  constructor(private readonly service: PlatformPaymentApprovalService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  overview(@Req() req: ApiRequest, @Query("after") after: unknown) {
    return this.service.overview(req, after);
  }

  @Post("grants/:userId")
  @Header("Cache-Control", "no-store")
  grant(
    @Req() req: ApiRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.service.grant(req, userId, body);
  }

  @Post("policy")
  @Header("Cache-Control", "no-store")
  policy(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.service.policy(req, body);
  }

  @Post("receivers/:tenantId/:storeId/review")
  @Header("Cache-Control", "no-store")
  review(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("storeId") storeId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.service.review(req, tenantId, storeId, body);
  }
}
