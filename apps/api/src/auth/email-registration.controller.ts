import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "./request-security";
import { EmailRegistrationService } from "./email-registration.service";

@Controller("auth")
export class EmailRegistrationController {
  constructor(private readonly registration: EmailRegistrationService) {}

  @Post("register")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  async register(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.registration.register(body);
  }

  @Post("verify-email")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async verifyEmail(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.registration.verify(body);
  }
}
