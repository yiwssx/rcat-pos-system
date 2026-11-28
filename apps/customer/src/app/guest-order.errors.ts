import { HttpErrorResponse } from "@angular/common/http";

export function isBillClosureRequired(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 409 &&
    (error.error as { message?: string } | null)?.message ===
      "BILL_CLOSURE_REQUIRED"
  );
}

export function guestError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return "เชื่อมต่อไม่ได้ โปรดตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
    if (error.status === 404)
      return "ไม่พบข้อมูลที่ร้องขอ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง";
    if (error.status === 409) {
      const message = (error.error as { message?: string } | null)?.message;
      if (isBillClosureRequired(error))
        return "โต๊ะยังมีบิลรอบก่อน กรุณาแจ้งพนักงานให้ตรวจสอบและปิดบิลก่อนสั่งอาหาร";
      if (message === "ORDERING_CLOSED")
        return "ขออภัย ร้านยังไม่เปิดให้สั่งอาหาร กรุณาลองใหม่ภายหลัง";
      if (
        message === "Idempotency key already used for another cart" ||
        message === "Idempotency key reused with another cart"
      )
        return "คำสั่งซื้อถูกเปลี่ยนระหว่างส่ง โปรดตรวจสอบตะกร้าก่อนลองอีกครั้ง";
      return "ข้อมูลมีการเปลี่ยนแปลง กรุณาตรวจสอบแล้วลองอีกครั้ง";
    }
    if (error.status === 429)
      return "มีการเรียกใช้งานจำนวนมาก กรุณารอสักครู่ก่อนลองใหม่";
    if (error.status === 400)
      return "สินค้า/ตัวเลือกไม่ตรงกับเมนูล่าสุด กรุณาตรวจสอบรายการ";
    if (error.status >= 500)
      return "เซิร์ฟเวอร์ไม่พร้อม โปรดลองใหม่โดยไม่เปลี่ยนตะกร้า";
  }
  return error instanceof Error ? error.message : "ไม่สามารถดำเนินการได้";
}
