import { describe, expect, it } from "vitest";
import {
  parseRecoveryFragment,
  restoreTrackingList,
  TRACKING_MAX_AGE_MS,
} from "./guest-tracking.domain";

const now = 1700000000000;
const order1 = "10000000-0000-4000-8000-000000000001";
const order2 = "10000000-0000-4000-8000-000000000002";
const first = {
  orderId: order1,
  trackingToken: "a".repeat(43),
  createdAt: now - 1000,
};
const second = {
  orderId: order2,
  trackingToken: "b".repeat(43),
  createdAt: now - 500,
};
describe("tab-scoped independent tracking capabilities", () => {
  it("preserves legacy tracking and expiry when another Order is saved", () => {
    const result = restoreTrackingList(
      JSON.stringify([second]),
      JSON.stringify(first),
      now,
    );
    expect(result.orders).toEqual([second, first]);
    expect(result.active).toEqual(first);
    expect(
      restoreTrackingList(
        JSON.stringify(result.orders),
        JSON.stringify(result.active),
        now + TRACKING_MAX_AGE_MS - 1000,
      ).orders,
    ).toEqual([second]);
  });
  it("rejects expired recovery, malformed records and noncanonical fragments", () => {
    expect(
      restoreTrackingList(
        JSON.stringify([
          { ...first, expiresAt: now },
          { ...second, createdAt: now + 1 },
        ]),
        null,
        now,
      ).orders,
    ).toEqual([]);
    expect(
      parseRecoveryFragment("#" + order1 + "." + first.trackingToken),
    ).toEqual({ orderId: order1, claimToken: first.trackingToken });
    expect(
      parseRecoveryFragment(
        "#" + order1 + "." + first.trackingToken + ".extra",
      ),
    ).toBeNull();
  });
});
