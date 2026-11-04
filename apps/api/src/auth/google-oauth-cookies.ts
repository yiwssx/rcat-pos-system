export const GOOGLE_STATE_COOKIE = "__Host-rcat_google_state";
export const GOOGLE_NONCE_COOKIE = "__Host-rcat_google_nonce";
export const GOOGLE_VERIFIER_COOKIE = "__Host-rcat_google_pkce";
const OAUTH_MAX_AGE = 5 * 60;

function cookieHeader(name: string, value: string, ageSeconds: number): string {
  return [
    `${name}=${value}`, "HttpOnly", "Secure", "SameSite=Lax", "Path=/",
    `Max-Age=${ageSeconds}`,
  ].join("; ");
}

export function googleOauthCookies(
  state: string,
  nonce: string,
  verifier: string,
): string[] {
  return [
    cookieHeader(GOOGLE_STATE_COOKIE, state, OAUTH_MAX_AGE),
    cookieHeader(GOOGLE_NONCE_COOKIE, nonce, OAUTH_MAX_AGE),
    cookieHeader(GOOGLE_VERIFIER_COOKIE, verifier, OAUTH_MAX_AGE),
  ];
}
export function clearGoogleOauthCookies(): string[] {
  return [
    GOOGLE_STATE_COOKIE,
    GOOGLE_NONCE_COOKIE,
    GOOGLE_VERIFIER_COOKIE,
  ].map((name) => cookieHeader(name, "", 0));
}
