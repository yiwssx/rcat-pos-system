/**
 * G5-M1 server-side Thai QR / PromptPay payload encoder.
 * Pure and intentionally NOT connected to any HTTP endpoint or receiver config.
 * Never treat a QR, payment amount or an uploaded slip as bank confirmation.
 *
 * Thai QR Payment (BoT), EMVCo Merchant-Presented TLV: 29 = PromptPay, 53 = THB,
 * 54 = amount, 63 = CRC-16/CCITT-FALSE.
 */
export type PromptPayReceiverKind = "mobile" | "national_id";

export interface PromptPayRequest {
  receiverKind: PromptPayReceiverKind;
  receiverId: string;
  amountSatang: number;
}

// Existing rcat.orders.amount_satang constraint. Not a business-side amount lock.
const MAX_ORDER_SATANG = 100_000_000;
const PROMPTPAY_AID = "A000000677010111";

function field(tag: string, value: string): string {
  if (!/^[0-9]{2}$/.test(tag) || !/^[\x20-\x7e]*$/.test(value) || value.length > 99) {
    throw new RangeError("Invalid Thai QR field");
  }
  return tag + String(value.length).padStart(2, "0") + value;
}

/** ISO/IEC 13239 CRC-16/CCITT-FALSE, with the literal 6304 prefix included. */
export function thaiQrCrc(payloadWithCrcPrefix: string): string {
  if (!/^[\x20-\x7e]*$/.test(payloadWithCrcPrefix)) {
    throw new RangeError("Invalid Thai QR input");
  }
  let crc = 0xffff;
  for (let i = 0; i < payloadWithCrcPrefix.length; i += 1) {
    crc ^= payloadWithCrcPrefix.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0
        ? ((crc << 1) ^ 0x1021) & 0xffff
        : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * A separate logical QR may be displayed per Order, but an identical receiver
 * and amount produce identical bank payloads; NO bank-level order reference.
 *
 * The receiver MUST be taken from a store-approved server-side snapshot.
 * Never accept a guest-provided receiver or amount.
 */
export function buildPromptPayPayload(request: PromptPayRequest): string {
  if (!Number.isSafeInteger(request.amountSatang) ||
      request.amountSatang <= 0 || request.amountSatang > MAX_ORDER_SATANG) {
    throw new RangeError("Invalid Order amount");
  }
  if (typeof request.receiverId !== "string") {
    throw new RangeError("Invalid PromptPay receiver");
  }
  // Ordinary bank accounts are NOT supported by this PromptPay-ID encoder.
  let subTag: string;
  let receiver: string;
  if (request.receiverKind === "mobile") {
    if (!/^0[689][0-9]{8}$/.test(request.receiverId)) {
      throw new RangeError("Invalid PromptPay mobile number");
    }
    subTag = "01";
    receiver = "0066" + request.receiverId.slice(1);
  } else if (request.receiverKind === "national_id") {
    if (!/^[0-9]{13}$/.test(request.receiverId)) {
      throw new RangeError("Invalid PromptPay national/tax ID");
    }
    subTag = "02";
    receiver = request.receiverId;
  } else {
    throw new RangeError("Unsupported PromptPay receiver kind");
  }

  const amount = String(Math.floor(request.amountSatang / 100)) + "." +
    String(request.amountSatang % 100).padStart(2, "0");
  const merchantInfo = field("00", PROMPTPAY_AID) + field(subTag, receiver);
  // Point-of-initiation 12 indicates a payload generated for a payment flow;
  // it is NOT a one-time token or a guaranteed bank-locked amount.
  const payload = field("00", "01") + field("01", "12") +
    field("29", merchantInfo) + field("53", "764") +
    field("54", amount) + field("58", "TH") + "6304";
  return payload + thaiQrCrc(payload);
}
