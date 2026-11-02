import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Req,
} from "@nestjs/common";
import { ApiRequest, requireAllowedOrigin } from "../auth/request-security";
import { StaffAdministrationService } from "./staff-administration.service";

@Controller("tenants/:tenantId/staff")
@Header("Cache-Control", "no-store")
export class StaffAdministrationController {
  constructor(private readonly staff: StaffAdministrationService) {}

  @Get()
  async list(@Req() req: ApiRequest, @Param("tenantId") tenantId: string) {
    return this.staff.list(req, tenantId);
  }

  @Patch(":userId")
  async changeRole(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    requireAllowedOrigin(req);
    return this.staff.changeRole(req, tenantId, userId, body);
  }

  @Delete(":userId")
  @HttpCode(204)
  async remove(
    @Req() req: ApiRequest,
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
  ) {
    requireAllowedOrigin(req);
    await this.staff.remove(req, tenantId, userId);
  }
}
