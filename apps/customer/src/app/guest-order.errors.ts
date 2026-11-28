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

// Avoid echoing raw server errors or assuming a network failure means the
// payment evidence was not stored. The Order capability is never cleared.
export function paymentSlipError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    switch (error.status) {
      case 0:
        return "เชื่อมต่อไม่ได้ กรุณาตรวจสอบสถานะออเดอร์ก่อนลองส่งสลิปอีกครั้ง";
      case 400:
        return "รูปสลิปไม่ผ่านการตรวจสอบ (400) กรุณาเลือกภาพ PNG หรือ JPG ที่อ่านชัดเจน";
      case 403:
      case 404:
        return "ไม่สามารถส่งสลิปสำหรับออเดอร์นี้ได้ กรุณาตรวจสอบสถานะกับร้าน";
      case 409:
        return "ข้อมูลสลิปมีการเปลี่ยนแปลงหรือมีสลิปรอตรวจอยู่ กรุณาตรวจสอบสถานะกับร้าน";
      case 413:
        return "รูปสลิปมีขนาดใหญ่เกินกำหนด (413) กรุณาเลือกภาพขนาดเล็กลงที่อ่านชัดเจน";
      case 429:
        return "มีการเรียกใช้งานจำนวนมาก กรุณารอสักครู่ก่อนลองใหม่";
      default:
        return "ส่งสลิปไม่สำเร็จ กรุณาตรวจสอบสถานะออเดอร์กับร้านก่อนลองใหม่";
    }
  }
  return error instanceof Error ? error.message : "ไม่สามารถอ่านรูปสลิปได้";
}
