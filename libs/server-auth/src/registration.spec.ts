import { describe, expect, it } from "vitest";
import { normalizeRegistrationEmail } from "./registration";

describe("development operator email validation", () => {
  it("canonicalizes and accepts ordinary addresses", () => {
    expect(normalizeRegistrationEmail(" Owner@Example.COM ")).toBe(
      "owner@example.com",
    );
  });

  it.each(["", " ", "not-an-email", "x@y", "a@b.c d", "bad\nmail@test.invalid"])(
    "rejects invalid email %s",
    (value) => {
      expect(() => normalizeRegistrationEmail(value)).toThrow();
    },
  );
});
