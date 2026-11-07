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

function riff(chunks: Buffer[]): Buffer {
  const bytes = Buffer.concat([
    Buffer.from("RIFF0000WEBP", "ascii"),
    ...chunks,
  ]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([
    header,
    data,
    data.length & 1 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
}

function extended(width: number, height: number, alpha = false): Buffer {
  const header = Buffer.alloc(10);
  header[0] = alpha ? 0x10 : 0;
  header.writeUIntLE(width - 1, 4, 3);
  header.writeUIntLE(height - 1, 7, 3);
  const compressed = vp8(width, height).subarray(20);
  return riff([
    chunk("VP8X", header),
    ...(alpha ? [chunk("ALPH", Buffer.from([0, 0xff]))] : []),
    chunk("VP8 ", compressed),
  ]);
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

  it("accepts metadata-free Chromium VP8X with and without an opaque alpha chunk", () => {
    for (const alpha of [false, true]) {
      const data = extended(320, 180, alpha);
      expect(validateWebp(data)).toEqual({
        bytes: data,
        width: 320,
        height: 180,
      });
    }
  });

  it("rejects VP8X animation, ICC/EXIF/XMP, mismatched canvas or extra chunks", () => {
    for (const flag of [0x02, 0x04, 0x08, 0x20, 0x40, 0x01]) {
      const file = extended(320, 180);
      file[20] = flag;
      expect(() => validateWebp(file)).toThrow();
    }
    const wrongSize = extended(320, 180);
    wrongSize[24] = 0x00;
    expect(() => validateWebp(wrongSize)).toThrow();
    const withXmp = extended(320, 180);
    const extra = riff([
      withXmp.subarray(12),
      chunk("XMP ", Buffer.from("sensitive metadata")),
    ]);
    expect(() => validateWebp(extra)).toThrow();
    const illegalAlpha = extended(320, 180, true);
    illegalAlpha[20] = 0; // ALPH may not be present if flag omitted.
    expect(() => validateWebp(illegalAlpha)).toThrow();
  });

  it("rejects oversized, zero-dimension and untrusted non-buffer inputs", () => {
    expect(() => validateWebp(vp8(0, 300))).toThrow();
    expect(() => validateWebp(vp8(1601, 200))).toThrow();
    expect(() => validateWebp(Buffer.alloc(196609))).toThrow();
    expect(() => validateWebp({ type: "image/webp" })).toThrow();
  });
});
