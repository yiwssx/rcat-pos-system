import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
export const MAX_SLIP_BYTES = 524_288;

/**
 * Only canonical RGB/RGBA, 8-bit, noninterlaced PNG images are accepted.
 * No EXIF, text, ICC profile, animation, alternate streams, embedded links,
 * auxiliary chunks or file paths. The authenticated staff view serves
 * validated bytes with a private, no-store and same-origin response.
 */
export function validatePaymentSlipPng(raw: unknown): {
  png: Buffer;
  sha256: Buffer;
} {
  if (
    !Buffer.isBuffer(raw) ||
    raw.length < 80 ||
    raw.length > MAX_SLIP_BYTES ||
    !raw.subarray(0, 8).equals(SIGNATURE)
  ) {
    throw new RangeError("Invalid payment PNG");
  }
  const chunks: Buffer[] = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let count = 0;
  let hasImageData = false;
  let ended = false;
  const acceptedImageChunks = new Set<string>();
  while (offset < raw.length) {
    if (raw.length - offset < 12) {
      throw new RangeError("Invalid PNG structure");
    }
    const length = raw.readUInt32BE(offset);
    const chunkEnd = offset + length + 12;
    if (length > MAX_SLIP_BYTES || chunkEnd > raw.length) {
      throw new RangeError("Invalid PNG chunk length");
    }
    const type = raw.toString("ascii", offset + 4, offset + 8);
    const data = raw.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = raw.readUInt32BE(offset + 8 + length);
    if (crc32(raw.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) {
      throw new RangeError("Invalid PNG chunk checksum");
    }
    if (count === 0 && type !== "IHDR") {
      throw new RangeError("Missing PNG header");
    }
    if (type === "IHDR") {
      if (count !== 0 || length !== 13) {
        throw new RangeError("Invalid PNG header");
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const color = data[9];
      if (
        width < 1 ||
        height < 1 ||
        width > 2048 ||
        height > 2048 ||
        bitDepth !== 8 ||
        (color !== 2 && color !== 6) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        throw new RangeError("Unsupported PNG format");
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      if (ended) throw new RangeError("PNG has trailing chunks");
      hasImageData = true;
      chunks.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || !hasImageData || chunkEnd !== raw.length) {
        throw new RangeError("Invalid PNG end");
      }
      ended = true;
    } else if (
      type === "pHYs" ||
      type === "gAMA" ||
      type === "sRGB" ||
      type === "cHRM"
    ) {
      // Browsers may encode standard resolution/color information in PNG.
      // These fixed-size, non-identifying chunks are safe; EXIF, textual,
      // ICC, animation and other arbitrary ancillary chunks remain forbidden.
      const fixedLength: Record<string, number> = {
        pHYs: 9,
        gAMA: 4,
        sRGB: 1,
        cHRM: 32,
      };
      if (
        hasImageData ||
        acceptedImageChunks.has(type) ||
        length !== fixedLength[type] ||
        (type === "pHYs" && data[8]! > 1) ||
        (type === "sRGB" && data[0]! > 3)
      ) {
        throw new RangeError("Invalid PNG image metadata");
      }
      acceptedImageChunks.add(type);
    } else {
      // Intentionally reject tEXt/iTXt/eXIf/iCCP, APNG and unknown chunks.
      throw new RangeError("Unsafe PNG metadata or chunk");
    }
    count += 1;
    if (count > 64) throw new RangeError("Too many PNG chunks");
    offset = chunkEnd;
  }
  if (!ended || chunks.length < 1) {
    throw new RangeError("Incomplete PNG");
  }
  const expectedLength = height * (1 + width * channels);
  if (expectedLength > 12 * 1024 * 1024) {
    throw new RangeError("Payment PNG dimensions too large");
  }
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(chunks), {
      maxOutputLength: expectedLength + 1,
    });
  } catch {
    throw new RangeError("Invalid PNG image data");
  }
  if (pixels.length !== expectedLength) {
    throw new RangeError("Invalid PNG raster length");
  }
  for (let row = 0; row < height; row += 1) {
    if (pixels[row * (1 + width * channels)]! > 4) {
      throw new RangeError("Invalid PNG filter");
    }
  }
  return {
    png: Buffer.from(raw),
    sha256: createHash("sha256").update(raw).digest(),
  };
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
