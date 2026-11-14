import * as QRCode from "qrcode";
import { Injectable, NotFoundException } from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import { GuestRequestBudgetService } from "../ordering/guest-request-budget.service";
import { guestPaymentQrEnvelope } from "./guest-payment-request.core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

/**
 * The only guest payment route consumes the same Order-scoped bearer as
 * existing tracking. No table/visit URL token and no client prices accepted.
 *
 * Two independent release gates must be satisfied: the operator-controlled
 * server env flag AND store receiver.enabled, which is not merchant-writable.
 * The default outcome is `available:false`, with NO live QR.
 */
@Injectable()
export class GuestPaymentRequestService {
  constructor(
    private readonly database: DatabaseAccess,
    private readonly guestBudget: GuestRequestBudgetService,
  ) {}

  async request(
    req: ApiRequest,
    orderId: string,
    authorization: string | undefined,
  ) {
    if (!UUID.test(orderId)) {
      throw new NotFoundException("Payment request unavailable");
    }
    const token = TRACKING_BEARER.exec(authorization ?? "")?.[1];
    if (!token) {
      throw new NotFoundException("Payment request unavailable");
    }
    await this.guestBudget.consume(req, "tracking", token);
    let tokenDigest: Buffer;
    try {
      tokenDigest = digestOpaqueSecret(token);
    } catch {
      throw new NotFoundException("Payment request unavailable");
    }

    let data: unknown;
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: unknown }>(
          "SELECT rcat_private.guest_order_payment_request($1,$2,$3) AS data",
          [
            orderId,
            tokenDigest,
            process.env["RCAT_POS_PAYMENT_QR_RELEASE_APPROVED"] === "true",
          ],
        ),
      );
      data = result.rows[0]?.data;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: unknown }).code
          : undefined;
      if (code === "42501" || code === "28000") {
        throw new NotFoundException("Payment request unavailable");
      }
      throw error;
    }

    const envelope = guestPaymentQrEnvelope(orderId, data);
    if (!envelope.available) return { available: false as const };
    const qrImageDataUrl = await QRCode.toDataURL(envelope.qrPayload, {
      type: "image/png",
      errorCorrectionLevel: "M",
      margin: 4,
      width: 512,
    });
    const { qrPayload: _payload, ...publicResponse } = envelope;
    return {
      ...publicResponse,
      qrImageDataUrl,
      // A QR is NEVER proof of bank transfer or Merchant confirmation.
      merchantConfirmation: false as const,
    };
  }
}
