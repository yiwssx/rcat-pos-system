import { describe, expect, it } from "vitest";
import { normalizeRegistrationEmail } from "./registration";

describe("development operator email validation", () => {
  it("canonicalizes and accepts ordinary addresses", () => {
    expect(normalizeRegistrationEmail(" Owner@Example.COM ")).toBe(
      "owner@example.com",
    );
  });

  it("rejects empty, malformed and unsafe email strings", () => {
    expect(() => normalizeRegistrationEmail("")).toThrow();
    expect(() => normalizeRegistrationEmail(" ")).toThrow();
    expect(() => normalizeRegistrationEmail("not-an-email")).toThrow();
    expect(() => normalizeRegistrationEmail("x@y")).toThrow();
    expect(() => normalizeRegistrationEmail("a@b.c d")).toThrow();
    const newlineEmail = "bad\nmail@test.invalid";
    expect(() => normalizeRegistrationEmail(newlineEmail)).toThrow();
  });
});
