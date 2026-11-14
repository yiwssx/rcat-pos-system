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

  it("accepts standard browser Canvas resolution chunk without allowing EXIF", async () => {
    const image = await sample();
    const phys = Buffer.from(
      "000000097048597300000ec400000ec401952b0e1b",
      "hex",
    );
    // PNG signature (8) + IHDR chunk (25) precedes browser pHYs.
    const fromCanvas = Buffer.concat([
      image.subarray(0, 33),
      phys,
      image.subarray(33),
    ]);
    expect(validatePaymentSlipPng(fromCanvas).sha256.length).toBe(32);

    // Valid CRC text chunk, not merely malformed bytes: reject its content.
    const text = Buffer.from("00000003744558744b0076f349b570", "hex");
    expect(() =>
      validatePaymentSlipPng(
        Buffer.concat([image.subarray(0, 33), text, image.subarray(33)]),
      ),
    ).toThrow();
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
