// The API independently parses and validates the uploaded PNG. This client
// conversion is for browser compatibility, not an authorization boundary.
export const MAX_PAYMENT_SLIP_BYTES = 524288;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Canvas implementations can emit ICC profiles and many small IDAT chunks.
// Keep just the raster and its required framing. Do not transmit browser-
// generated or source metadata; the server's strict validator is unchanged.
export async function canonicalizeCanvasPng(
  blob: Blob,
  byteLimit = MAX_PAYMENT_SLIP_BYTES,
): Promise<Blob | null> {
  const input = new Uint8Array(await blob.arrayBuffer());
  const invalid = (): never => {
    throw new Error("เบราว์เซอร์ไม่สามารถสร้างรูป PNG ที่รองรับได้");
  };
  if (
    input.length < 45 ||
    input.length > 8 * 1024 * 1024 ||
    !SIGNATURE.every((value, index) => input[index] === value)
  ) {
    invalid();
  }
  const view = new DataView(input.buffer);
  const imageData: Uint8Array[] = [];
  let header: Uint8Array | null = null;
  let endChunk: Uint8Array | null = null;
  let dataLength = 0;
  let afterImageData = false;
  for (let offset = 8; offset < input.length;) {
    if (input.length - offset < 12) invalid();
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > input.length) invalid();
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    const data = input.subarray(offset + 8, end - 4);
    if (!/^[A-Za-z]{4}$/.test(type) || (!header && type !== "IHDR")) invalid();
    if (type === "IHDR") {
      if (header || offset !== 8 || length !== 13) invalid();
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      if (
        width < 1 ||
        height < 1 ||
        width > 1200 ||
        height > 1200 ||
        data[8] !== 8 ||
        (data[9] !== 2 && data[9] !== 6) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        invalid();
      }
      header = input.subarray(offset, end);
    } else if (type === "IDAT") {
      if (afterImageData) invalid();
      dataLength += length;
      imageData.push(data);
      // Framing: signature + IHDR + one IDAT + IEND.
      if (dataLength + 57 > byteLimit) return null;
    } else if (type === "IEND") {
      if (length !== 0 || !dataLength || end !== input.length) invalid();
      endChunk = input.subarray(offset, end);
    } else {
      // Unknown critical chunks, transparency and animation can alter the
      // meaning of the raster. Never silently strip them.
      if (
        type[0] === type[0].toUpperCase() ||
        ["tRNS", "acTL", "fcTL", "fdAT"].includes(type)
      ) {
        invalid();
      }
      if (imageData.length) afterImageData = true;
    }
    offset = end;
  }
  if (!header || !endChunk || !dataLength) return invalid();
  const total = dataLength + 57;
  if (total < 80 || total > byteLimit) return null;
  const output = new Uint8Array(total);
  output.set(SIGNATURE);
  output.set(header, 8);
  const outView = new DataView(output.buffer);
  outView.setUint32(33, dataLength);
  output.set([73, 68, 65, 84], 37); // IDAT
  let cursor = 41;
  for (const data of imageData) {
    output.set(data, cursor);
    cursor += data.length;
  }
  outView.setUint32(cursor, crc32(output.subarray(37, cursor)));
  output.set(endChunk, cursor + 4);
  return new Blob([output.buffer], { type: "image/png" });
}

export async function preparePaymentSlipPng(
  source: File,
  document: Document,
  byteLimit = MAX_PAYMENT_SLIP_BYTES,
): Promise<Blob> {
  if (
    !source.size ||
    source.size > 8 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp"].includes(source.type)
  ) {
    throw new Error("รองรับเฉพาะรูป PNG, JPG หรือ WebP ไม่เกิน 8 MB");
  }
  const win = document.defaultView;
  if (!win) throw new Error("กรุณาเปิดหน้าออเดอร์ในเบราว์เซอร์");
  // Use the same broadly supported image decode path as Merchant photo
  // upload rather than relying on createImageBitmap on mobile WebViews.
  const url = win.URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = document.createElement("img");
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("ไม่สามารถอ่านรูปสลิปได้"));
      element.src = url;
    });
    if (
      image.naturalWidth < 1 ||
      image.naturalHeight < 1 ||
      image.naturalWidth > 4096 ||
      image.naturalHeight > 4096
    ) {
      throw new Error("รูปสลิปมีขนาดไม่เหมาะสม");
    }
    const canvas = document.createElement("canvas");
    for (const maxSide of [1200, 960, 720, 560]) {
      const scale = Math.min(
        1,
        maxSide / Math.max(image.naturalWidth, image.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("ไม่สามารถอ่านรูปสลิปได้");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (result?.type === "image/png") {
        const png = await canonicalizeCanvasPng(result, byteLimit);
        if (png) return png;
      }
    }
    throw new Error("ไม่สามารถลดขนาดรูปสลิปได้ โปรดใช้ภาพที่อ่านชัดเจน");
  } finally {
    win.URL.revokeObjectURL(url);
  }
}
