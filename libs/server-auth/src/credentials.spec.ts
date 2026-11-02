import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./credentials";

describe("server password hashing", () => {
  it("uses a random salt and verifies valid passwords", async () => {
    const password = "unique-password-2026";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^scrypt\$32768\$/);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("incorrect-password", first)).toBe(false);
  });

  it("rejects malformed and weak inputs", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
    await expect(hashPassword("x".repeat(1025))).rejects.toThrow();
    expect(await verifyPassword("anything", "bad-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});
