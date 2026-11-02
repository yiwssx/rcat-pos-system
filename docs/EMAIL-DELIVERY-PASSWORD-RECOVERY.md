# Transactional email and password recovery (Issue #3 — partial)

The email provider adapter and password-reset state machine are implemented. **No live external email has been sent or verified. Public registration and recovery routes remain disabled outside isolated CI.**

## Implemented
- Server-only delivery adapter: `MAIL_PROVIDER=test` for isolated CI, or `MAIL_PROVIDER=resend` for a future explicitly approved deployment.
- Resend direct HTTPS REST API (`POST https://api.resend.com/emails`), fixed endpoint, Bearer API key, idempotency key, 6-second timeout, text-only HTML-safe content, no forwarding provider errors or secrets to clients.
- 256-bit email verification/recovery tokens, with only SHA-256 digests saved in PostgreSQL.
- Registration email: existing 30-minute, single-use email-verification token. If an unambiguous send failure occurs, its exact pending token is withdrawn (safe against overwriting a newer token).
- Password recovery: 20-minute, single-use token; 60-second per-account database cooldown; no reset token for unknown accounts; unknown and successful requests share a generic response (except CI-only test token).
- Password change and revocation of **all** existing sessions execute atomically in PostgreSQL.
- Login session issuance is now conditioned on the same password hash still being current while locking the user row, preventing a login/recovery race from minting a session with a stale password hash.
- SQL and HTTP negative tests cover expired/replayed tokens, revoked sessions, wrong Origin, unverified account rejection, and old-password invalidation.

## Verified environment gates
`POST /api/auth/register` and `POST /api/auth/verify-email` still require all: `CI=true`, `NODE_ENV=test`, `ENABLE_DEVELOPMENT_AUTH=true`, `ENABLE_REGISTRATION_TEST_MODE=true`.

New `POST /api/auth/password/forgot` and `POST /api/auth/password/reset` require all: `CI=true`, `NODE_ENV=test`, `ENABLE_DEVELOPMENT_AUTH=true`, `ENABLE_RECOVERY_TEST_MODE=true`.

Raw test-only tokens are exposed by responses **only in this isolated CI test mode**. NEVER enable any of these flags in publicly accessible environments. Real-world mail provider configuration alone does not make auth/public APIs production-ready.

## Email provider environment (future security-reviewed rollout)
```dotenv
MAIL_PROVIDER=resend
RESEND_API_KEY=                  # private, environment or secret vault only
MAIL_FROM_EMAIL=no-reply@your-verified-domain.example
EMAIL_ACTION_BASE_URL=https://pos.your-domain.example/account
```

Do not commit real credentials. Use a sender domain verified with the provider, proper SPF/DKIM/DMARC, and a send-only restricted API key. No user-supplied email URL is accepted. Provider receipts indicate API acceptance, **not** inbox delivery.

The email links include the token in the `#token=` fragment so the browser does not send it to the server in its HTTP request URI. The planned frontend must read and immediately remove this fragment, then POST the token securely, without analytics/referrer or frontend error logging.

## Blocking production release gates
- Real mail domain/provider setup and live deliverability verification, provider retries/reconciliation or encrypted durable outbox, bounce/webhook handling, provider circuit breaker.
- Distributed and per-IP/account rate limiting, automated abuse detection, non-enumerating API responses, tenant/admin security audit.
- No raw tokens in response or logs; reviewed browser flows for reset and verification; account takeover and token theft tests.
- Stable CSRF/origin/TLS enforcement and session lifecycle security review, backup/restore, observability and failure drills.
- Automated account recovery emails and verified registration must be safely exposed only after these gates pass.

`/api/ready` remains HTTP 503; no Payment or PromptPay code is touched (G5).
