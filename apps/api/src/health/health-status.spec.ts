import { describe, expect, it } from "vitest";
import { foundationHealth } from "./health-status";

describe("foundation API health", () => {
  it("never represents the new scaffold as production ready", () => {
    const health = foundationHealth();
    expect(health.healthy).toBe(true);
    expect(health.productionReady).toBe(false);
    expect(health.acceptingOrders).toBe(false);
    expect(health.paymentEnabled).toBe(false);
  });
});
