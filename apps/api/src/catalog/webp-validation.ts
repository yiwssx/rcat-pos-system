import { BadRequestException } from "@nestjs/common";

// Deliberately accept only single-frame RIFF WebP (VP8/VP8L).
// Reject VP8X metadata/EXIF/XMP/animation and polyglot/trailing chunks.
// Client converts JPEG/PNG to WebP; server never trusts MIME or extension.
export const MAX_WEBP_BYTES = 196608;

export function validateWebp(raw: unknown): {
  bytes: Buffer;
  width: number;
  height: number;
} {
  const bad = (): never => {
    throw new BadRequestException("Invalid WebP image");
  };
  if (!Buffer.isBuffer(raw)) {
    throw new BadRequestException("Invalid WebP image");
  }
  const bytes = raw;
  if (bytes.length < 30 || bytes.length > MAX_WEBP_BYTES) bad();
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  )
    bad();
  const type = bytes.toString("ascii", 12, 16);
  const size = bytes.readUInt32LE(16);
  if (size < 10 || 20 + size + (size & 1) !== bytes.length) bad();
  let width = 0;
  let height = 0;
  if (type === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) bad();
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else if (type === "VP8L") {
    if (bytes[20] !== 0x2f || size < 5) bad();
    const bits = bytes.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else {
    bad();
  }
  if (width < 1 || height < 1 || width > 1600 || height > 1600) bad();
  return { bytes, width, height };
}
