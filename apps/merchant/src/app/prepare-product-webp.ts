// Client-side convenience conversion only. The server independently parses
// and limits the WebP RIFF body, so MIME type or this transformation is never
// used as an authorization/security boundary.
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
      const context = canvas.getContext("2d");
      if (!context) throw new Error("เบราว์เซอร์ไม่รองรับการเตรียมรูปภาพ");
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
        return output;
      }
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
    }
    throw new Error("ไม่สามารถลดขนาดภาพให้อยู่ในเกณฑ์ 192 KB ได้");
  } finally {
    win.URL.revokeObjectURL(src);
  }
}
