import { describe, expect, it } from "vitest";
import { googleLoginFailureNotice } from "./portal-login-feedback";

describe("Google Workspace login callback feedback", () => {
  it("shows a safe Thai message after the failure-only callback redirect", () => {
    const notice = googleLoginFailureNotice("failed");
    expect(notice).toContain("เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
    expect(notice).toContain("@rcat.ac.th");
    expect(notice).not.toContain("client_secret");
  });

  it("does not show the failure alert on a normal or successful landing", () => {
    expect(googleLoginFailureNotice(null)).toBeNull();
    expect(googleLoginFailureNotice("ok")).toBeNull();
    expect(googleLoginFailureNotice("failed%0Asecret")).toBeNull();
    expect(googleLoginFailureNotice("FAILED")).toBeNull();
  });
});
