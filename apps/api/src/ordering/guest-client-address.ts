import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { BlockList, isIP } from "node:net";
import type { ApiRequest } from "../auth/request-security";

function address(value: string | undefined): string | null {
  if (!value) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  const normalized = mapped && isIP(mapped[1]!) === 4 ? mapped[1]! : value;
  return isIP(normalized) ? normalized : null;
}

/**
 * Never trust a forwarded address unless the socket peer is explicitly
 * trusted. Walk XFF right-to-left and select the first untrusted hop,
 * so client-supplied forged prefixes cannot choose a different identity.
 */
export function guestClientAddress(
  req: ApiRequest,
  proxyCidrs: string | undefined,
): string {
  const peer = address(req.socket.remoteAddress);
  if (!peer) {
    throw new ServiceUnavailableException("Guest network identity unavailable");
  }
  if (!proxyCidrs?.trim()) return peer;
  const block = new BlockList();
  try {
    for (const raw of proxyCidrs.split(",")) {
      const match = /^(.+)\/(\d{1,3})$/.exec(raw.trim());
      const net = address(match?.[1]);
      const family = net ? isIP(net) : 0;
      const prefix = Number(match?.[2]);
      if (
        !net ||
        !family ||
        !Number.isInteger(prefix) ||
        prefix < (family === 4 ? 8 : 32) ||
        prefix > (family === 4 ? 32 : 128)
      ) {
        throw new Error("Invalid trusted proxy network");
      }
      block.addSubnet(net, prefix, family === 4 ? "ipv4" : "ipv6");
    }
  } catch {
    // Unsafe trust configuration must not silently disable rate limiting.
    throw new ServiceUnavailableException("Trusted proxy policy invalid");
  }
  const trusted = (ip: string): boolean =>
    block.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  if (!trusted(peer)) return peer;
  const raw = req.headers["x-forwarded-for"];
  if (typeof raw !== "string" || raw.length > 1024) {
    throw new BadRequestException("Trusted proxy must supply a bounded XFF");
  }
  const values = raw.split(",");
  if (values.length < 1 || values.length > 10) {
    throw new BadRequestException("Invalid forwarded address chain");
  }
  const hops = values.map((value) => address(value.trim()));
  if (hops.some((ip) => !ip)) {
    throw new BadRequestException("Invalid forwarded address chain");
  }
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i]!;
    if (!trusted(hop!)) return hop!;
  }
  // All hops are trusted; use the actual verified socket peer rather than
  // trusting a potentially client-supplied prefix.
  return peer;
}
