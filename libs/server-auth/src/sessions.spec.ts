import { describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  constantTimeDigestMatch,
  createSessionCookie,
  digestOpaqueSecret,
  newOpaqueSecret,
} from "./sessions";

describe("server-only session and CSRF primitives", () => {
  it("generates unpredictable 256-bit secrets and stores only digests", () => {
    const one = newOpaqueSecret();
    const two = newOpaqueSecret();
    expect(one).toHaveLength(43);
    expect(two).not.toBe(one);
    const digest = digestOpaqueSecret(one);
    expect(digest).toHaveLength(32);
    expect(digest.toString("base64url")).not.toBe(one);
    expect(constantTimeDigestMatch(digest, one)).toBe(true);
    expect(constantTimeDigestMatch(digest, two)).toBe(false);
    expect(constantTimeDigestMatch(digest, "malformed")).toBe(false);
  });

  it("sets secure host-only cookies and supports logout", () => {
    const secret = newOpaqueSecret();
    const cookie = createSessionCookie(secret);
    expect(cookie).toContain("__Host-rcat_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});
