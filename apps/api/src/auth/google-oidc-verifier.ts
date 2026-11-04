import { createPublicKey, timingSafeEqual, verify } from "node:crypto";

export interface GoogleWorkspaceIdentity {
  sub: string;
  email: string;
}
interface GoogleKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}
export interface GoogleJwks {
  keys: GoogleKey[];
}

function jsonObject(encoded: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{1,8000}$/.test(encoded)) {
    throw new Error("Invalid ID token encoding");
  }
  const raw = Buffer.from(encoded, "base64url");
  if (raw.length > 6000) throw new Error("ID token too large");
  const parsed: unknown = JSON.parse(raw.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Malformed ID token object");
  }
  return parsed as Record<string, unknown>;
}

function equalOpaque(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyGoogleWorkspaceIdToken(
  jwt: string,
  clientId: string,
  expectedNonce: string,
  jwks: GoogleJwks,
  nowSeconds = Math.floor(Date.now() / 1000),
): GoogleWorkspaceIdentity {
  if (
    typeof jwt !== "string" ||
    jwt.length > 10000 ||
    typeof clientId !== "string" ||
    !clientId ||
    !/^[A-Za-z0-9_-]{43}$/.test(expectedNonce)
  ) {
    throw new Error("Invalid Google ID token input");
  }
  const parts = jwt.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]{100,9000}$/.test(parts[2]!)) {
    throw new Error("Invalid ID token signature");
  }
  const header = jsonObject(parts[0]!);
  const payload = jsonObject(parts[1]!);
  if (
    header["alg"] !== "RS256" ||
    typeof header["kid"] !== "string" ||
    header["kid"].length > 150 ||
    !/^[A-Za-z0-9_-]+$/.test(header["kid"]) ||
    (header["typ"] !== undefined && header["typ"] !== "JWT")
  ) {
    throw new Error("Unapproved Google signature algorithm");
  }

  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const key = keys.find(
    (k) =>
      k.kid === header["kid"] &&
      k.kty === "RSA" &&
      (!k.alg || k.alg === "RS256") &&
      (!k.use || k.use === "sig") &&
      typeof k.n === "string" &&
      typeof k.e === "string" &&
      /^[A-Za-z0-9_-]+$/.test(k.n) &&
      /^[A-Za-z0-9_-]+$/.test(k.e) &&
      Buffer.from(k.n, "base64url").length >= 256,
  );
  if (!key) throw new Error("Google signing key unavailable");
  const publicKey = createPublicKey({
    key: { kty: "RSA", n: key.n!, e: key.e! },
    format: "jwk",
  });
  const signed = Buffer.from(parts[0] + "." + parts[1], "ascii");
  const signature = Buffer.from(parts[2], "base64url");
  if (!verify("RSA-SHA256", signed, publicKey, signature)) {
    throw new Error("ID token signature invalid");
  }

  // The hosted-domain hint in the authorization URL is NOT authority.
  // Only the signed claims bind this login to the RCAT Workspace.
  if (
    payload["iss"] !== "https://accounts.google.com" &&
    payload["iss"] !== "accounts.google.com"
  ) {
    throw new Error("Google issuer mismatch");
  }
  if (
    payload["aud"] !== clientId ||
    (payload["azp"] !== undefined && payload["azp"] !== clientId)
  ) {
    throw new Error("Google audience mismatch");
  }
  if (
    !Number.isSafeInteger(payload["exp"]) ||
    !Number.isSafeInteger(payload["iat"]) ||
    (payload["exp"] as number) <= nowSeconds ||
    (payload["exp"] as number) > nowSeconds + 2 * 60 * 60 ||
    (payload["iat"] as number) > nowSeconds + 60
  ) {
    throw new Error("Google ID token expired or invalid");
  }
  if (
    payload["nonce"] !== expectedNonce ||
    !equalOpaque(String(payload["nonce"]), expectedNonce)
  ) {
    throw new Error("ID token nonce mismatch");
  }
  if (
    payload["hd"] !== "rcat.ac.th" ||
    payload["email_verified"] !== true ||
    typeof payload["email"] !== "string"
  ) {
    throw new Error("Workspace domain or email not verified");
  }
  const email = payload["email"].toLowerCase();
  if (
    email !== payload["email"] ||
    !/^[^\s@]+@rcat\.ac\.th$/.test(email) ||
    email.length > 254
  ) {
    throw new Error("Non-RCAT Workspace email");
  }
  const sub = payload["sub"];
  if (
    typeof sub !== "string" ||
    sub.length < 1 ||
    sub.length > 255 ||
    !/^[A-Za-z0-9_-]+$/.test(sub)
  ) {
    throw new Error("Invalid Google account subject");
  }
  return { sub, email };
}
