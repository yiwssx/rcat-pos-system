import { describe, expect, it } from "vitest";
import { FOUNDATION_STATUS } from "./status-labels";

describe("shared frontend state labels", () => {
  it("does not pretend a payment system exists", () => {
    expect(FOUNDATION_STATUS.unavailable).toBe("Not available");
  });
});
