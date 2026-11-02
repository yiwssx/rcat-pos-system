import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  NotFoundException,
} from "@nestjs/common";
import {
  createSessionCookie,
  hasMerchantPermission,
} from "../../../../libs/server-auth/src";
import { AuthService } from "./auth.service";
import { ApiRequest, requireAllowedOrigin } from "./request-security";
import { DatabaseAccess } from "../database/db-access";

interface CookieResponse {
  setHeader(name: string, value: string | string[]): void;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Req() req: ApiRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: CookieResponse,
  ) {
    requireAllowedOrigin(req);
    const result = await this.auth.login(req, body);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Set-Cookie", [
      createSessionCookie(result.token),
      this.auth.csrfCookie(result.csrf),
    ]);
    return { userId: result.userId, authenticated: true };
  }

  @Get("me")
  async me(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ) {
    const session = await this.auth.session(req);
    res.setHeader("Cache-Control", "no-store");
    return { authenticated: true, userId: session.userId };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<void> {
    requireAllowedOrigin(req);
    const session = await this.auth.session(req);
    this.auth.requireCsrf(req, session);
    await this.auth.logout(session.token);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Set-Cookie",
      ["", ""].map((_, i) =>
        i === 0
          ? "__Host-rcat_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
          : this.auth.clearCsrfCookie(),
      ),
    );
  }
}

@Controller("tenants")
export class TenantStoreController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseAccess,
  ) {}

  @Get(":tenantId/stores")
  async stores(@Req() req: ApiRequest, @Param("tenantId") tenantId: string) {
    if (!UUID.test(tenantId)) {
      throw new NotFoundException();
    }
    const session = await this.auth.session(req);
    const role = await this.auth.membership(session.userId, tenantId);
    if (!role || !hasMerchantPermission(role, "store.read")) {
      throw new NotFoundException();
    }
    const result = await this.database.tenant(tenantId, (client) =>
      client.query<{ id: string; slug: string; display_name: string }>(
        "SELECT id,slug,display_name FROM rcat.stores ORDER BY slug",
      ),
    );
    return { tenantId, role, stores: result.rows };
  }
}
