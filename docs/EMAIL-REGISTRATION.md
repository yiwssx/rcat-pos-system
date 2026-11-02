# Email verification foundation (Issue #3 — partial)

This milestone adds **test-only** registration and email-verification state transitions. The application still does **not** offer public self-registration or send email.

## Flow

1. An isolated automated test calls `POST /api/auth/register` with an email address and password.
2. The password is salted and hashed server-side with the existing scrypt implementation; PostgreSQL stores a pending email claim, a token **digest** (not the raw token), and a 30-minute deadline. No active user is inserted yet.
3. The CI-only response exposes a verification token under `testVerificationToken`. This is safe **only in an ephemeral isolated CI environment**.
4. `POST /api/auth/verify-email` consumes the token once; its transaction creates an active user with the pending password hash.
5. Only after successful verification can the new account log in and create its tenant/store.

## Security properties

- Both test endpoints require an exact allowed Origin and fail closed unless **all** flags are present: `CI=true`, `NODE_ENV=test`, `ENABLE_DEVELOPMENT_AUTH=true`, and `ENABLE_REGISTRATION_TEST_MODE=true`.
- A real environment may never return verification tokens in the HTTP response. These are **not** production APIs.
- `rcat_auth` can only execute narrowly scoped SECURITY DEFINER registration functions. The auth role cannot select from or write the pending password-hash/token table directly.
- Pending email claims expire in 30 minutes; repeated requests on the same email are throttled transactionally for at least 60 seconds; existing accounts are not modified.
- Verification uses a random 256-bit token represented by a 32-byte SHA-256 digest in the database. Wrong, expired and reused tokens cannot create accounts.
- A 202 response does not mean an account exists or any email was sent. No email provider is configured.

## Remaining before a usable signup feature

Select and integrate an email delivery provider through a server-only adapter, store no plaintext verification tokens after transmission, implement request/IP throttling across replicas, resend and recovery policies, non-enumerating public response behavior, abuse monitoring and audit. Test delivery failures and recovery before enabling any public registration endpoint. Add CSRF/origin policy appropriate to public browser signup and reviewed production infrastructure.

Payment/PromptPay remains the final functional milestone, G5.
