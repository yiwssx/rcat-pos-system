import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import prettier from "prettier";

describe("temporary formatter probe", () => {
  it("prints the exact Prettier output to repair the PR", async () => {
    const path = "apps/merchant/src/app/merchant-catalog.page.ts";
    const original = readFileSync(path, "utf8");
    const formatted = await prettier.format(original, { filepath: path });
    if (original !== formatted) {
      console.log("FORMAT_PROBE_BEGIN\n" + formatted + "\nFORMAT_PROBE_END");
    }
    expect(formatted).toBe(original);
  });
});
