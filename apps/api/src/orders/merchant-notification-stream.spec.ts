import { describe, expect, it } from "vitest";
import { encodeOrderSse } from "./merchant-notification-stream.core";
import type { MerchantNotificationEvent } from "./merchant-notifications.service";

describe("durable merchant SSE envelope", () => {
  const event: MerchantNotificationEvent = {
    eventId: "9007199254740993",
    eventType: "order.status.changed",
    orderId: "11111111-1111-4111-8111-111111111111",
    tableId: "22222222-2222-4222-8222-222222222222",
    status: "accepted",
    previousStatus: "submitted",
    occurredAt: "2026-11-04T05:00:00Z",
  };

  it("preserves a 64-bit event ID as an SSE string, never a JS Number", () => {
    const frame = encodeOrderSse(event);
    expect(frame).toContain("id: 9007199254740993\n");
    expect(frame).toContain("event: order-event\n");
    expect(frame.endsWith("\n\n")).toBe(true);
    const data = frame.split("\n").find((line) => line.startsWith("data: "));
    expect(data).toBeDefined();
    expect(JSON.parse(data!.slice(6))).toEqual({
      eventId: "9007199254740993",
      orderId: event.orderId,
      eventType: "order.status.changed",
      status: "accepted",
    });
  });

  it("never leaks token capabilities, payments, actor IDs, or item snapshots", () => {
    const frame = encodeOrderSse({
      ...event,
      // Guard future changes against accidental serialization of extra data.
      trackingToken: "forbidden",
      amountSatang: 9000,
      actorUserId: "forbidden",
    } as MerchantNotificationEvent);
    expect(frame).not.toContain("trackingToken");
    expect(frame).not.toContain("amountSatang");
    expect(frame).not.toContain("actorUserId");
    expect(frame).not.toContain("tableId");
    expect(frame).not.toContain("payment");
  });

  it("rejects a line-injected Last-Event-ID stored as event data", () => {
    expect(() =>
      encodeOrderSse({ ...event, eventId: "1\nevent: forgery" }),
    ).toThrow("Invalid Order outbox event ID");
    expect(() => encodeOrderSse({ ...event, eventId: "0" })).toThrow();
    expect(() => encodeOrderSse({ ...event, eventId: "-1" })).toThrow();
  });
});
