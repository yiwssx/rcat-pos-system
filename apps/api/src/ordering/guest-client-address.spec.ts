import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { guestClientAddress } from "./guest-client-address";

function req(peer: string, forwarded?: string): IncomingMessage {
  return {
    socket: { remoteAddress: peer },
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
  } as IncomingMessage;
}

describe("G4 trusted Guest proxy attribution", () => {
  it("ignores spoofed XFF when peer is not explicitly trusted", () => {
    expect(
      guestClientAddress(req("203.0.113.15", "1.1.1.1"), undefined),
    ).toBe("203.0.113.15");
    expect(
      guestClientAddress(req("203.0.113.15", "1.1.1.1"), "10.10.1.0/24"),
    ).toBe("203.0.113.15");
  });

  it("walks trusted proxy chain right-to-left and ignores fake prefixes", () => {
    expect(
      guestClientAddress(
        req("10.10.1.5", "198.51.100.123, 203.0.113.35, 10.10.1.9"),
        "10.10.1.0/24",
      ),
    ).toBe("203.0.113.35");
    expect(
      guestClientAddress(
        req("::ffff:10.10.1.5", "203.0.113.35"),
        "10.10.1.0/24",
      ),
    ).toBe("203.0.113.35");
  });

  it("denies malformed chains, missing XFF and unsafe proxy policies", () => {
    expect(() =>
      guestClientAddress(req("10.10.1.5"), "10.10.1.0/24"),
    ).toThrow();
    expect(() =>
      guestClientAddress(req("10.10.1.5", "1.2.3.4:88"), "10.10.1.0/24"),
    ).toThrow();
    expect(() =>
      guestClientAddress(req("10.10.1.5", "1.2.3.4"), "0.0.0.0/0"),
    ).toThrow();
    expect(() =>
      guestClientAddress(req("10.10.1.5", "1.2.3.4"), "not-a-cidr"),
    ).toThrow();
  });

  it("does not trust forged all-private-hop chains as an external client", () => {
    expect(
      guestClientAddress(
        req("10.10.1.5", "10.10.1.1,10.10.1.2"),
        "10.10.1.0/24",
      ),
    ).toBe("10.10.1.5");
  });
});
