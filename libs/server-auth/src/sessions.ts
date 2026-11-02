import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET_BYTES = 32;
const SESSION_COOKIE = "__Host-rcat_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export function newOpaqueSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

export function digestOpaqueSecret(secret: string): Buffer {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error("Invalid opaque secret format");
  }
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.length !== SECRET_BYTES) {
    throw new Error("Invalid opaque secret length");
  }
  return createHash("sha256").update(decoded).digest();
}

export function constantTimeDigestMatch(
  stored: Buffer,
  candidateSecret: string,
): boolean {
  if (stored.length !== 32) {
    return false;
  }
  try {
    const actual = digestOpaqueSecret(candidateSecret);
    return timingSafeEqual(stored, actual);
  } catch {
    return false;
  }
}

export function createSessionCookie(secret: string): string {
  digestOpaqueSecret(secret);
  return [
    `${SESSION_COOKIE}=${secret}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}
