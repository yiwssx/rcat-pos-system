import { createHmac } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import { guestClientAddress } from "./guest-client-address";

type GuestLane = "redeem" | "resolve" | "page" | "checkout" | "tracking";

/**
 * Shared PostgreSQL rate budgets, not per-process Maps. The network peer
 * defaults to the socket peer. Explicitly configured trusted proxy CIDRs
 * permit right-to-left XFF attribution without trusting forged client hops.
 */
@Injectable()
export class GuestRequestBudgetService {
  constructor(private readonly database: DatabaseAccess) {}

  async consume(
    req: ApiRequest,
    lane: GuestLane,
    token?: string,
  ): Promise<void> {
    const ip = guestClientAddress(
      req,
      process.env["GUEST_TRUSTED_PROXY_CIDRS"],
    );
    const pepper = process.env["GUEST_TABLE_CODE_PEPPER"];
    if (!ip || !pepper || !/^[0-9a-f]{64}$/.test(pepper)) {
      // Public Guest endpoints cannot silently bypass abuse protection.
      throw new ServiceUnavailableException(
        "Guest request limits not configured",
      );
    }
    const subject = (kind: string, value: string): Buffer =>
      createHmac("sha256", Buffer.from(pepper, "hex"))
        .update("rcat-pos-guest-budget-v1\0" + kind + "\0" + value)
        .digest();
    const allowed = await this.database.auth(async (client) => {
      const ipResult = await client.query<{ allowed: boolean }>(
        "SELECT rcat_private.claim_guest_request_budget($1,$2) AS allowed",
        [lane + "-ip", subject("ip", ip)],
      );
      if (!ipResult.rows[0]?.allowed) return false;
      if (!token) return true;
      const tokenResult = await client.query<{ allowed: boolean }>(
        "SELECT rcat_private.claim_guest_request_budget($1,$2) AS allowed",
        [lane + "-token", subject("token", token)],
      );
      return tokenResult.rows[0]?.allowed === true;
    });
    if (!allowed) {
      throw new HttpException(
        "Too many guest requests; retry after the request window",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
