/** Generic OAuth callback feedback, never disclose provider or account details. */
export function googleLoginFailureNotice(
  queryValue: string | null,
): string | null {
  return queryValue === "failed"
    ? "เข้าสู่ระบบด้วย Google ไม่สำเร็จ โปรดใช้บัญชี @rcat.ac.th ที่ได้รับสิทธิ์ หากยังกลับมาหน้านี้ให้ผู้ดูแลตรวจสอบการตั้งค่า Google OAuth และบัญชีผู้ใช้ที่อนุมัติไว้"
    : null;
}
