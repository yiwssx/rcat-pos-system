import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = 32768;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: COST, r: 8, p: 1, maxmem: MAX_MEMORY },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result as Buffer);
        }
      },
    );
  });
}

/**
 * Server-side authentication primitive. Never expose without throttling,
 * account enumeration resistance, session checks and verified tenant access.
 */
export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password, salt);
  return `scrypt$${COST}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password, "utf8") > 1024
  ) {
    return false;
  }
  const fields = encoded.split("$");
  if (
    fields.length !== 4 ||
    fields[0] !== "scrypt" ||
    fields[1] !== String(COST)
  ) {
    return false;
  }
  const salt = Buffer.from(fields[2] ?? "", "base64url");
  const expected = Buffer.from(fields[3] ?? "", "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) {
    return false;
  }
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}

function validatePassword(value: string): void {
  if (typeof value !== "string") {
    throw new Error("Password is required");
  }
  if (
    Array.from(value).length < 12 ||
    Buffer.byteLength(value, "utf8") > 1024
  ) {
    throw new Error("Password must have 12+ characters and <=1024 bytes");
  }
}
