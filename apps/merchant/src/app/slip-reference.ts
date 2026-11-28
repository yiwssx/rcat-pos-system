// Bank slip Mini-QR (SCB developer documentation: extracting-data-from-mini-qr).
// A valid CRC only checks encoding integrity, never bank settlement.
export interface SlipReference {
  sendingBank: string;
  transactionReference: string;
}

function readTlv(value: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  for (let offset = 0; offset < value.length;) {
    const tag = value.slice(offset, offset + 2);
    const size = value.slice(offset + 2, offset + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(size) || fields.has(tag)) {
      return null;
    }
    const length = Number(size);
    const end = offset + 4 + length;
    if (!length || end > value.length) return null;
    fields.set(tag, value.slice(offset + 4, end));
    offset = end;
  }
  return fields;
}

export function slipCrc(value: string): string {
  let crc = 0xffff;
  for (let i = 0; i < value.length; i++) {
    crc ^= value.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function parseSlipReference(payload: string): SlipReference | null {
  // User-supplied data: do not navigate to URLs, interpret arbitrary text,
  // accept a payment QR, or turn a fabricated reference into payment proof.
  if (
    payload.length > 117 ||
    !/^[\x20-\x7e]+$/.test(payload) ||
    !/9104[0-9A-Fa-f]{4}$/.test(payload) ||
    slipCrc(payload.slice(0, -4)) !== payload.slice(-4).toUpperCase()
  ) {
    return null;
  }
  const fields = readTlv(payload);
  if (
    fields?.size !== 3 ||
    [...fields.keys()].join(",") !== "00,51,91" ||
    fields.get("51") !== "TH" ||
    fields.get("91") !== payload.slice(-4)
  ) {
    return null;
  }
  const envelope = fields.get("00");
  if (!envelope || !fields.has("91")) return null;
  const inner = readTlv(envelope);
  if (inner?.size !== 3 || inner.get("00") !== "000001") return null;
  const sendingBank = inner.get("01") ?? "";
  const transactionReference = inner.get("02") ?? "";
  if (
    !/^\d{3}$/.test(sendingBank) ||
    !/^[A-Za-z0-9._-]{6,25}$/.test(transactionReference)
  ) {
    return null;
  }
  return { sendingBank, transactionReference };
}

export async function decodeSlipReference(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<SlipReference | null> {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 2048 ||
    height > 2048 ||
    pixels.length !== width * height * 4
  ) {
    return null;
  }
  // Loaded only on the existing authorized merchant review route.
  // Images and decoded values never leave the browser.
  const { default: jsQR } = await import("jsqr");
  const decoded = jsQR(pixels, width, height);
  return decoded ? parseSlipReference(decoded.data) : null;
}
