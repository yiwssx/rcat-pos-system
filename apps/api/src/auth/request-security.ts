import { ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";

export type ApiRequest = IncomingMessage;

export function header(req: ApiRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

export function cookie(req: ApiRequest, name: string): string | undefined {
  const raw = header(req, "cookie");
  if (!raw || raw.length > 4096) return undefined;
  const values = raw.split(";").map((value) => value.trim());
  const found = values.filter((entry) => entry.startsWith(name + "="));
  if (found.length !== 1) return undefined;
  return found[0]?.slice(name.length + 1);
}

export function requireAllowedOrigin(req: ApiRequest): void {
  const allowed = (process.env["AUTH_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const origin = header(req, "origin");
  if (!origin || !allowed.includes(origin)) {
    throw new ForbiddenException("Origin is not allowed");
  }
}

type Limit = { count: number; expires: number };
const failures = new Map<string, Limit>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function loginThrottle(req: ApiRequest, email: string): {
  succeeded(): void;
  failed(): void;
} {
  // A bounded development-only limiter. Distributed gateway throttling is
  // required before production and ENABLE_DEVELOPMENT_AUTH is hard-disabled there.
  const ip = req.socket.remoteAddress ?? "unknown";
  const fingerprint = createHash("sha256")
    .update(ip + ":" + email.toLowerCase())
    .digest("hex");
  const now = Date.now();
  if (failures.size > 2000) {
    for (const [key, entry] of failures) {
      if (entry.expires <= now) failures.delete(key);
    }
    if (failures.size > 2000) failures.clear();
  }
  const entry = failures.get(fingerprint);
  if (entry && entry.expires > now && entry.count >= MAX_ATTEMPTS) {
    throw new ForbiddenException("Too many login attempts");
  }
  return {
    succeeded: () => failures.delete(fingerprint),
    failed: () => {
      const next = failures.get(fingerprint);
      failures.set(fingerprint, {
        count: next && next.expires > now ? next.count + 1 : 1,
        expires: now + WINDOW_MS,
      });
    },
  };
}

export const SESSION_COOKIE = "__Host-rcat_session";
export const CSRF_COOKIE = "__Host-rcat_csrf";
