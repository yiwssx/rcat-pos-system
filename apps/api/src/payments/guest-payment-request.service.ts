import * as QRCode from "qrcode";
import { Injectable, NotFoundException } from "@nestjs/common";
import { digestOpaqueSecret } from "../../../../libs/server-auth/src";
import { ApiRequest } from "../auth/request-security";
import { DatabaseAccess } from "../database/db-access";
import { GuestRequestBudgetService } from "../ordering/guest-request-budget.service";
import { buildPromptPayPayload, PromptPayReceiverKind } from "./promptpay-qr.core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

interface PaymentRequestData {
  available: boolean;
  requestId?: string;
  orderId?: string;
  amountSatang?: number | string;
  currency?: string;
  state?: string;
  receiverKind?: PromptPayReceiverKind;
  receiverId?: string;
  createdAt?: string;
}

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

    let data: PaymentRequestData | undefined;
    try {
      const result = await this.database.auth((client) =>
        client.query<{ data: PaymentRequestData }>(
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

    if (!data || data.available !== true) {
      // A non-enabled store, unapproved release or cancelled Order
      // cannot expose a payment QR or a receiver identifier.
      return { available: false as const };
    }

    const amount = Number(data.amountSatang);
    if (
      !data.requestId ||
      !data.orderId ||
      data.orderId.toLowerCase() !== orderId.toLowerCase() ||
      data.currency !== "THB" ||
      data.state !== "awaiting_payment" ||
      !data.receiverKind ||
      !data.receiverId
    ) {
      throw new Error("Invalid server payment snapshot");
    }
    const payload = buildPromptPayPayload({
      amountSatang: amount,
      receiverKind: data.receiverKind,
      receiverId: data.receiverId,
    });
    const qrSvg = await QRCode.toString(payload, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
      width: 512,
    });
    return {
      available: true as const,
      requestId: data.requestId,
      orderId: data.orderId,
      amountSatang: amount,
      currency: "THB" as const,
      state: "awaiting_payment" as const,
      createdAt: data.createdAt,
      qrSvg,
      // Standard personal PromptPay QR is NOT unique bank settlement proof.
      merchantConfirmation: false,
    };
  }
}
