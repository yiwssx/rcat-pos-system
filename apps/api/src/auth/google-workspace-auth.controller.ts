import { Controller, Get, Header, Query, Req, Res } from "@nestjs/common";
import { ServerResponse } from "node:http";
import { ApiRequest } from "./request-security";
import { clearGoogleOauthCookies } from "./google-oauth-cookies";
import { GoogleWorkspaceAuthService } from "./google-workspace-auth.service";

@Controller("auth/google")
export class GoogleWorkspaceAuthController {
  constructor(private readonly google: GoogleWorkspaceAuthService) {}

  @Get("start")
  @Header("Cache-Control", "no-store")
  start(@Res() res: ServerResponse): void {
    const start = this.google.start();
    res.statusCode = 302;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Set-Cookie", start.cookies);
    res.setHeader("Location", start.redirect);
    res.end();
  }

  @Get("callback")
  @Header("Cache-Control", "no-store")
  async callback(
    @Req() req: ApiRequest,
    @Query("state") state: unknown,
    @Query("code") code: unknown,
    @Res() res: ServerResponse,
  ): Promise<void> {
    // Google does not send a same-origin Origin header on redirect.
    // The cryptographically random, HttpOnly __Host state cookie (plus
    // PKCE and signed-ID-token nonce) is the CSRF protection for this GET.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const login = await this.google.complete(req, state, code);
      res.setHeader("Set-Cookie", [
        ...clearGoogleOauthCookies(),
        ...this.google.sessionCookies(login),
      ]);
      res.statusCode = 303;
      res.setHeader("Location", "/");
      res.end();
    } catch {
      // Always clear sensitive handshake cookies. Neither OAuth code nor
      // provider error is ever returned in the redirect URL or page HTML.
      res.setHeader("Set-Cookie", clearGoogleOauthCookies());
      res.statusCode = 303;
      res.setHeader("Location", "/?login=failed");
      res.end();
    }
  }
}
