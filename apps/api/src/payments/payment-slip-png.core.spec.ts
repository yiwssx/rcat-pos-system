import * as QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { validatePaymentSlipPng } from "./payment-slip-png.core";

async function sample(): Promise<Buffer> {
  const image = await QRCode.toDataURL("synthetic-g5-payment-slip", {
    type: "image/png",
    width: 192,
    margin: 1,
  });
  return Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
}

describe("private slip PNG trust boundary", () => {
  it("accepts bounded PNG without exposing a path or metadata", async () => {
    const image = await sample();
    const result = validatePaymentSlipPng(image);
    expect(result.png.equals(image)).toBe(true);
    expect(result.sha256.length).toBe(32);
  });

  it("rejects non-PNG, invalid image CRC and appended content", async () => {
    const image = await sample();
    expect(() => validatePaymentSlipPng(Buffer.from("<svg/>"))).toThrow();
    const corrupted = Buffer.from(image);
    corrupted[24] = corrupted[24]! ^ 0x01;
    expect(() => validatePaymentSlipPng(corrupted)).toThrow();
    expect(() =>
      validatePaymentSlipPng(Buffer.concat([image, Buffer.from("<script/>")])),
    ).toThrow();
  });

  it("rejects oversized images, non-buffer and truncated data", async () => {
    const image = await sample();
    expect(() => validatePaymentSlipPng(Buffer.alloc(524289, 0))).toThrow();
    expect(() => validatePaymentSlipPng("data:image/png;base64,...")).toThrow();
    expect(() => validatePaymentSlipPng(image.subarray(0, 20))).toThrow();
  });
});
