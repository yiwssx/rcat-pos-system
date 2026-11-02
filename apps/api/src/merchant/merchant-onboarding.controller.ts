import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { MerchantOnboardingService } from "./merchant-onboarding.service";

@Controller()
export class MerchantOnboardingController {
  constructor(private readonly onboarding: MerchantOnboardingService) {}

  @Post("tenants")
  @Header("Cache-Control", "no-store")
  async createTenant(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.onboarding.create(req, body);
  }

  @Post("tenants/:tenantId/invitations")
  @Header("Cache-Control", "no-store")
  async invite(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.onboarding.invite(req, tenantId, body);
  }

  @Post("invitations/accept")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async accept(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.onboarding.accept(req, body);
  }
}
