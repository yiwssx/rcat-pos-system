import { BadRequestException } from "@nestjs/common";

// Reject arbitrary containers, animation, ICC/EXIF/XMP and trailing chunks.
// Chromium may produce a valid VP8X container even after canvas conversion.
// Allow only VP8X + optional ALPH + one VP8/VP8L image, with strict bounds.
// This verifies framing/metadata; it is not a full codec bitstream decoder.
export const MAX_WEBP_BYTES = 196608;

function invalid(): never {
  throw new BadRequestException("Invalid WebP image");
}

interface Chunk {
  fourCC: string;
  payload: number;
  length: number;
  next: number;
}

function chunkAt(bytes: Buffer, at: number): Chunk {
  if (at < 12 || at + 8 > bytes.length) invalid();
  const length = bytes.readUInt32LE(at + 4);
  const payload = at + 8;
  const end = payload + length;
  const next = end + (length & 1);
  if (end > bytes.length || next > bytes.length ||
      (length & 1) === 1 && bytes[end] !== 0) invalid();
  return {
    fourCC: bytes.toString("ascii", at, at + 4),
    payload,
    length,
    next,
  };
}

function imageSize(bytes: Buffer, chunk: Chunk): { width: number; height: number } {
  let width = 0;
  let height = 0;
  if (chunk.fourCC === "VP8 ") {
    if (chunk.length < 10 ||
        bytes[chunk.payload + 3] !== 0x9d ||
        bytes[chunk.payload + 4] !== 0x01 ||
        bytes[chunk.payload + 5] !== 0x2a) invalid();
    width = bytes.readUInt16LE(chunk.payload + 6) & 0x3fff;
    height = bytes.readUInt16LE(chunk.payload + 8) & 0x3fff;
  } else if (chunk.fourCC === "VP8L") {
    if (chunk.length < 5 || bytes[chunk.payload] !== 0x2f) invalid();
    const bits = bytes.readUInt32LE(chunk.payload + 1);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else {
    invalid();
  }
  if (width < 1 || height < 1 || width > 1600 || height > 1600) invalid();
  return { width, height };
}

export function validateWebp(raw: unknown): {
  bytes: Buffer;
  width: number;
  height: number;
} {
  if (!Buffer.isBuffer(raw)) invalid();
  const bytes: Buffer = raw;
  if (bytes.length < 30 || bytes.length > MAX_WEBP_BYTES ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP" ||
      bytes.readUInt32LE(4) !== bytes.length - 8) invalid();

  let chunk = chunkAt(bytes, 12);
  if (chunk.fourCC !== "VP8X") {
    const size = imageSize(bytes, chunk);
    if (chunk.next !== bytes.length) invalid();
    return { bytes, ...size };
  }

  // VP8X flag bits: ICC=0x20, alpha=0x10, EXIF=0x08,
  // XMP=0x04, animation=0x02. All except alpha are disallowed.
  if (chunk.length !== 10) invalid();
  const flags = bytes[chunk.payload];
  if (flags === undefined || (flags & ~0x10) !== 0 ||
      bytes[chunk.payload + 1] !== 0 ||
      bytes[chunk.payload + 2] !== 0 ||
      bytes[chunk.payload + 3] !== 0) invalid();
  const width = 1 +
    bytes[chunk.payload + 4] +
    (bytes[chunk.payload + 5] << 8) +
    (bytes[chunk.payload + 6] << 16);
  const height = 1 +
    bytes[chunk.payload + 7] +
    (bytes[chunk.payload + 8] << 8) +
    (bytes[chunk.payload + 9] << 16);
  if (width < 1 || height < 1 || width > 1600 || height > 1600) invalid();

  chunk = chunkAt(bytes, chunk.next);
  let alphaSeen = false;
  if (chunk.fourCC === "ALPH") {
    if (flags !== 0x10 || chunk.length < 2) invalid();
    // Alpha compression mode is encoded in the low two bits; 0/1 defined.
    if ((bytes[chunk.payload] & 0x03) > 1) invalid();
    alphaSeen = true;
    chunk = chunkAt(bytes, chunk.next);
  }
  if (chunk.fourCC !== "VP8 " && chunk.fourCC !== "VP8L") invalid();
  if (alphaSeen && chunk.fourCC !== "VP8 ") invalid();
  if (flags === 0x10 && chunk.fourCC === "VP8 " && !alphaSeen) invalid();
  const image = imageSize(bytes, chunk);
  if (image.width !== width || image.height !== height ||
      chunk.next !== bytes.length) invalid();
  return { bytes, width, height };
}
