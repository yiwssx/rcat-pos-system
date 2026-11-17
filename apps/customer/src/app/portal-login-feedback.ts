/** Generic OAuth callback feedback, never disclose provider or account details. */
export function googleLoginFailureNotice(
  queryValue: string | null,
): string | null {
  return queryValue === "failed"
    ? "เข้าสู่ระบบด้วย Google ไม่สำเร็จ เฉพาะบัญชี @rcat.ac.th ที่ผู้ดูแลอนุญาตไว้เท่านั้น หากต้องการเข้าใช้งานโปรดติดต่อผู้ดูแลระบบ RCAT POS"
    : null;
}
