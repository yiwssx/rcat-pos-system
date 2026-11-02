import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "./request-security";
import { PasswordRecoveryService } from "./password-recovery.service";

@Controller("auth/password")
export class PasswordRecoveryController {
  constructor(private readonly recovery: PasswordRecoveryService) {}

  @Post("forgot")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  async forgot(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.recovery.request(body);
  }

  @Post("reset")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async reset(@Req() req: ApiRequest, @Body() body: unknown) {
    requireAllowedOrigin(req);
    return this.recovery.complete(body);
  }
}
