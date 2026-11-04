import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GoogleJwks,
  verifyGoogleWorkspaceIdToken,
} from "./google-oidc-verifier";
import {
  clearGoogleOauthCookies,
  googleOauthCookies,
} from "./google-oauth-cookies";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const n = publicKey.export({ format: "jwk" }) as {
  n: string;
  e: string;
};
const jwks: GoogleJwks = {
  keys: [
    { kty: "RSA", kid: "test-key", alg: "RS256", use: "sig", n: n.n, e: n.e },
  ],
};
const now = 1_800_000_000;
const nonce = "n".repeat(43);
const clientId = "sample-client.apps.googleusercontent.com";
const claims = {
  iss: "https://accounts.google.com",
  aud: clientId,
  sub: "109876543210098765432",
  email: "staff@rcat.ac.th",
  email_verified: true,
  hd: "rcat.ac.th",
  nonce,
  iat: now - 10,
  exp: now + 3600,
};
function token(
  payload: Record<string, unknown> = claims,
  header: Record<string, unknown> = {
    alg: "RS256",
    typ: "JWT",
    kid: "test-key",
  },
): string {
  const encoded = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = encoded(header) + "." + encoded(payload);
  return (
    input +
    "." +
    sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")
  );
}

describe("Google Workspace ID token verifier", () => {
  it("accepts only a Google-signed, verified RCAT domain identity", () => {
    expect(
      verifyGoogleWorkspaceIdToken(token(), clientId, nonce, jwks, now),
    ).toEqual({
      sub: claims.sub,
      email: "staff@rcat.ac.th",
    });
    expect(
      verifyGoogleWorkspaceIdToken(
        token({
          ...claims,
          iss: "accounts.google.com",
        }),
        clientId,
        nonce,
        jwks,
        now,
      ),
    ).toEqual({
      sub: claims.sub,
      email: "staff@rcat.ac.th",
    });
  });

  it("rejects bad issuer, audience and azp", () => {
    for (const changed of [
      { iss: "https://evil.example" },
      { aud: "other-client.apps.googleusercontent.com" },
      { azp: "attacker-client" },
    ]) {
      expect(() =>
        verifyGoogleWorkspaceIdToken(
          token({ ...claims, ...changed }),
          clientId,
          nonce,
          jwks,
          now,
        ),
      ).toThrow();
    }
  });

  it("rejects unverified, external and spoofed hosted-domain emails", () => {
    for (const changed of [
      { hd: "gmail.com" },
      { hd: undefined },
      { email: "staff@gmail.com" },
      { email: "staff@rcat.ac.th.evil.test" },
      { email_verified: false },
      { email: "Staff@rcat.ac.th" },
      { sub: "../not-google" },
    ]) {
      expect(() =>
        verifyGoogleWorkspaceIdToken(
          token({ ...claims, ...changed }),
          clientId,
          nonce,
          jwks,
          now,
        ),
      ).toThrow();
    }
  });

  it("rejects expired or future-issued claims and mismatching nonce", () => {
    for (const changed of [
      { exp: now - 1 },
      { exp: now + 10000 },
      { iat: now + 200 },
      { nonce: "x".repeat(43) },
    ]) {
      expect(() =>
        verifyGoogleWorkspaceIdToken(
          token({ ...claims, ...changed }),
          clientId,
          nonce,
          jwks,
          now,
        ),
      ).toThrow();
    }
  });

  it("rejects wrong signing key, tampered claims and unsigned JWTs", () => {
    const valid = token();
    const [head, body, sig] = valid.split(".");
    const altered = Buffer.from(
      JSON.stringify({
        ...claims,
        email: "admin@rcat.ac.th",
      }),
    ).toString("base64url");
    expect(() =>
      verifyGoogleWorkspaceIdToken(
        [head, altered, sig].join("."),
        clientId,
        nonce,
        jwks,
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyGoogleWorkspaceIdToken(
        token(claims, { alg: "none", kid: "test-key" }),
        clientId,
        nonce,
        jwks,
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyGoogleWorkspaceIdToken(valid, clientId, nonce, { keys: [] }, now),
    ).toThrow();
  });
});

describe("OAuth handshake cookies", () => {
  it("sets HttpOnly Secure host-scoped short-lived cookies and clears all", () => {
    const created = googleOauthCookies("s".repeat(43), nonce, "v".repeat(43));
    expect(created).toHaveLength(3);
    expect(
      created.every(
        (x) =>
          x.includes("HttpOnly") &&
          x.includes("Secure") &&
          x.includes("SameSite=Lax") &&
          x.includes("Path=/") &&
          x.includes("Max-Age=300"),
      ),
    ).toBe(true);
    const cleared = clearGoogleOauthCookies();
    expect(cleared).toHaveLength(3);
    expect(cleared.every((x) => x.includes("Max-Age=0"))).toBe(true);
  });
});
