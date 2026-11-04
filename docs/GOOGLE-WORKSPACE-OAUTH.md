# Google Workspace Authentication (@rcat.ac.th) — G1 Security Increment

The Merchant frontend provides a **Google Workspace sign-in** entry using
server-controlled Google OAuth 2.0 Authorization Code + PKCE S256. The
existing NestJS API sets its own scoped, HttpOnly session and independent
CSRF cookies after verifying a Google-issued **signed ID token**. This is
neither a public registration endpoint nor a tenant ID claimed by a browser.

## Required secrets and origins (not committed)

Configure these on the **API server** via a secret manager / protected
deployment configuration, not Angular build environment variables:

- `GOOGLE_OAUTH_CLIENT_ID`: OAuth 2.0 **Web application** client ID created
  in an authorized Google Cloud project
- `GOOGLE_OAUTH_CLIENT_SECRET`: client secret, kept server-side only
- `GOOGLE_OAUTH_REDIRECT_URI`: exact HTTPS URL
  `https://merchant.example/api/auth/google/callback`
- `AUTH_ALLOWED_ORIGINS`: includes the *exact* HTTPS origin of that callback
- `AUTH_DATABASE_URL`, `TENANT_DATABASE_URL`: separate least-privileged
  PostgreSQL pools as documented in `docs/AUTH-HTTP.md`

Configure that exact callback URI in the Google Cloud OAuth client's
Authorized redirect URIs. The Merchant app and API must be behind a
consistent HTTPS origin so Secure host-only cookies and CSRF work.
The `GOOGLE_TEST_TOKEN_ENDPOINT` and `GOOGLE_TEST_JWKS_ENDPOINT` overrides
are rejected **unless CI=true, NODE_ENV=test and development auth are all
enabled**, and only isolated HTTP loopback endpoints are allowed. They must
not be set in staging or Production.

## Protocol and session lifecycle

1. Browser visits `GET /api/auth/google/start` (normal link navigation).
   Backend requires development-enabled data services and valid OAuth
   configuration; generates cryptographically random State, Nonce and PKCE
   code verifier, stores them in three `__Host-` cookies with
   `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`, then redirects to
   Google's OAuth endpoint with `response_type=code`, `scope=openid email`,
   `code_challenge_method=S256` and `hd=rcat.ac.th` for UI hint.
2. Google redirects the browser back to the exact callback, including
   `state` and one-time `code`. API validates the State cookie with a
   constant-time comparison, uses server-side Client Secret and PKCE
   verifier to exchange the code at Google's token endpoint, then retrieves
   Google's public signing keys over HTTPS.
3. The returned ID token is checked for **RS256 signature** against a Google
   public JWKS key of adequate RSA size; acceptable issuer;
   `aud` and optional `azp` matching the fixed client ID; signed Nonce;
   current issuance/expiry; `email_verified=true`;
   `hd="rcat.ac.th"`; and an exact normalized `@rcat.ac.th` email.
   Merely putting `hd` or `login_hint` in a URL does not authorize staff.
   The Google `sub` is the stable identity binding, not email alone.
4. PostgreSQL migration 020 implements narrow SECURITY DEFINER
   `issue_google_workspace_session`. It requires a **pre-existing,
   active, pre-approved RCAT staff account** and binds the first verified
   Google `sub` permanently to that user. A later different `sub` using
   the same email (e.g. Workspace account deletion/re-creation) is denied
   to prevent account takeover. A Google `sub` may never be reused by
   another platform account. Neither `rcat_auth` nor `rcat_app` can
   directly read the private Google identity table.
5. Backend creates a new opaque Session and CSRF secret with 256-bit
   CSPRNG, stores SHA-256 digests, and returns Secure host-only cookies.
   All further Store access is checked through the existing backend
   session and tenant/role authorization on every operation. OAuth State
   cookies are cleared whether sign-in succeeded or failed; failures
   redirect to `/?login=failed` without tokens, staff email or provider
   error details. Browser never handles Google ID Token or Client Secret.

## Security boundaries and outstanding release gates

This is a **tested code increment, not Production-enablement**. The
existing DatabaseAccess module intentionally blocks
`ENABLE_DEVELOPMENT_AUTH=true` in `NODE_ENV=production`, and
`/api/ready` remains 503. Password registration and development login
still exist behind the development database gate; no claim is made that
a Google-only Production login policy is enforced yet. Before
production, #3/#10/#11 must replace this gate with a reviewed
Google-only auth mode, disable password/registration in Production,
implement distributed throttling, OAuth and session audit,
logout/device session management, user offboarding and password-reset
policy, verified HTTPS/CSP/proxy headers, and incident response.

An employee's Google account alone does not grant access to stores.
Existing role membership, staff invitations and tenant RBAC continue to
control Store authorization. Staff account provisioning, identity rebind
after Google Workspace account recreation, and deactivation require
administrator review; there is intentionally no unauthenticated
Google-signup-to-merchant path.

## Automated validation

- Pure unit tests sign synthetic JWTs with a test-only RSA key; verify
  rejection of wrong issuer/audience/azp, spoofed hosted domain,
  unverified email, future/expired claims, tampered signatures, missing
  signing key, mismatched Nonce and incorrect algorithms. OAuth cookie
  attribute/clear semantics are also tested.
- PostgreSQL rollback tests verify session issuance, sub-to-user
  uniqueness, email-recycling resistance, external/unknown/disabled account
  denial and direct table access refusal by runtime DB roles.
- Isolated HTTP integration runs a **loopback mock Google token+JWKS server**,
  exercises the actual NestJS OAuth redirects, PKCE verifier exchange,
  signed ID token, Google Session cookie, Merchant membership scope, forged
  State, non-RCAT hosted domain, changed Google subject, unapproved email
  and authorization code replay. CI mock keys/credentials are synthetic.
  No real Google credentials, accounts or user information are used.

No PromptPay/Payment is implemented; the G5 rule remains unchanged.
