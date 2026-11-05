import { describe, expect, it } from "vitest";
import { validateWebp } from "./webp-validation";

function vp8(width: number, height: number): Buffer {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(22, 4);
  data.write("WEBP", 8, "ascii");
  data.write("VP8 ", 12, "ascii");
  data.writeUInt32LE(10, 16);
  data[23] = 0x9d;
  data[24] = 0x01;
  data[25] = 0x2a;
  data.writeUInt16LE(width, 26);
  data.writeUInt16LE(height, 28);
  return data;
}

describe("G2 bounded WebP media validation", () => {
  it("only accepts scoped RIFF VP8 with bounded dimensions", () => {
    const sample = vp8(640, 480);
    expect(validateWebp(sample)).toEqual({
      bytes: sample,
      width: 640,
      height: 480,
    });
  });

  it("rejects SVG, invalid RIFF length, forbidden VP8X metadata and concatenated files", () => {
    expect(() =>
      validateWebp(Buffer.from('<svg onload="alert(1)">')),
    ).toThrow();
    const wrong = vp8(320, 240);
    wrong.writeUInt32LE(21, 4);
    expect(() => validateWebp(wrong)).toThrow();
    const extended = vp8(320, 240);
    extended.write("VP8X", 12);
    expect(() => validateWebp(extended)).toThrow();
    expect(() =>
      validateWebp(Buffer.concat([vp8(100, 100), vp8(50, 50)])),
    ).toThrow();
  });

  it("rejects oversized, zero-dimension and untrusted non-buffer inputs", () => {
    expect(() => validateWebp(vp8(0, 300))).toThrow();
    expect(() => validateWebp(vp8(1601, 200))).toThrow();
    expect(() => validateWebp(Buffer.alloc(196609))).toThrow();
    expect(() => validateWebp({ type: "image/webp" })).toThrow();
  });
});
