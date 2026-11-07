// Client-side convenience conversion only. The server independently parses
// and limits the WebP RIFF body, so MIME type or this transformation is never
// used as an authorization/security boundary.
// Chromium's WebP canvas encoder can embed its own 456-byte sRGB ICCP
// profile in a VP8X wrapper, even on an opaque canvas. Rebuild a BASELINE
// RIFF container from the encoded VP8/VP8L chunk, removing the profile
// entirely rather than weakening the server-side metadata rejection.
export async function canonicalizeCanvasWebp(blob: Blob): Promise<Blob> {
  const input = new Uint8Array(await blob.arrayBuffer());
  const invalid = (): never => {
    throw new Error("ไม่สามารถตรวจสอบรูปแบบไฟล์ WebP ที่เบราว์เซอร์สร้าง");
  };
  const ascii = (from: number, length: number): string =>
    String.fromCharCode(...input.subarray(from, from + length));
  if (
    input.length < 30 ||
    input.length > 196608 ||
    ascii(0, 4) !== "RIFF" ||
    ascii(8, 4) !== "WEBP"
  )
    invalid();
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(4, true) !== input.length - 8) invalid();

  const chunks: Array<{
    type: string;
    payload: number;
    size: number;
    offset: number;
    next: number;
  }> = [];
  for (let at = 12; at < input.length;) {
    if (at + 8 > input.length || chunks.length > 3) invalid();
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size;
    const next = end + (size & 1);
    if (next > input.length || ((size & 1) === 1 && input[end] !== 0))
      invalid();
    chunks.push({
      type: ascii(at, 4),
      payload: at + 8,
      size,
      offset: at,
      next,
    });
    at = next;
  }
  const frame = chunks[chunks.length - 1];
  if (!frame || (frame.type !== "VP8 " && frame.type !== "VP8L")) invalid();
  if (chunks.length === 1) return blob;

  const extended = chunks[0];
  if (!extended || extended.type !== "VP8X" || extended.size !== 10) invalid();
  const flags = input[extended.payload];
  if (
    (flags !== 0x00 && flags !== 0x20) ||
    input[extended.payload + 1] !== 0 ||
    input[extended.payload + 2] !== 0 ||
    input[extended.payload + 3] !== 0
  )
    invalid();
  const width =
    1 +
    input[extended.payload + 4] +
    (input[extended.payload + 5] << 8) +
    (input[extended.payload + 6] << 16);
  const height =
    1 +
    input[extended.payload + 7] +
    (input[extended.payload + 8] << 8) +
    (input[extended.payload + 9] << 16);
  if (width > 1600 || height > 1600) invalid();
  if (flags === 0x20) {
    if (
      chunks.length !== 3 ||
      chunks[1].type !== "ICCP" ||
      chunks[1].size < 1 ||
      chunks[1].size > 8192
    )
      invalid();
  } else if (chunks.length !== 2) {
    invalid();
  }

  // Do not copy VP8X, ICCP, EXIF, XMP, animation, or unrecognized chunks.
  // The resulting bytes are checked again by the API's strict validator.
  const length = 12 + (frame.next - frame.offset);
  const output = new Uint8Array(length);
  output.set(input.subarray(0, 12));
  output.set(input.subarray(frame.offset, frame.next), 12);
  new DataView(output.buffer).setUint32(4, length - 8, true);
  return new Blob([output.buffer], { type: "image/webp" });
}

export async function prepareProductWebp(
  file: File,
  document: Document,
): Promise<Blob> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    throw new Error("รองรับ JPG, PNG และ WebP ที่มีขนาดต้นฉบับไม่เกิน 8 MB");
  }
  const win = document.defaultView;
  if (!win) throw new Error("ต้องเปิดหน้าแก้ไขสินค้าผ่านเบราว์เซอร์");
  const src = win.URL.createObjectURL(file);
  let image: HTMLImageElement;
  try {
    image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = document.createElement("img");
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("ไฟล์รูปภาพไม่ถูกต้อง"));
      element.src = src;
    });
    if (
      image.naturalWidth < 1 ||
      image.naturalHeight < 1 ||
      image.naturalWidth * image.naturalHeight > 16000000
    ) {
      throw new Error("ภาพมีขนาดใหญ่เกินไป");
    }
    const canvas = document.createElement("canvas");
    const factor = Math.min(
      1,
      1200 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    let width = Math.max(1, Math.round(image.naturalWidth * factor));
    let height = Math.max(1, Math.round(image.naturalHeight * factor));
    for (let attempt = 0; attempt < 7; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      // Flatten all alpha over white. Chromium's default alpha-enabled
      // canvas may emit extended VP8X/ALPH chunks, which our strict
      // single-frame WebP ingestion deliberately rejects. An opaque canvas
      // emits a canonical baseline VP8 chunk without hidden metadata.
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("เบราว์เซอร์ไม่รองรับการเตรียมรูปภาพ");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const quality = Math.max(0.48, 0.8 - attempt * 0.05);
      const output = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (
        output &&
        output.type === "image/webp" &&
        output.size >= 30 &&
        output.size <= 196608
      ) {
        return canonicalizeCanvasWebp(output);
      }
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
    }
    throw new Error("ไม่สามารถลดขนาดภาพให้อยู่ในเกณฑ์ 192 KB ได้");
  } finally {
    win.URL.revokeObjectURL(src);
  }
}
