---
name: ci-quality
description: Use for repository structure, pull requests, Nx/pnpm affected CI, testing strategy, release and deployment gates.
---
# CI and Quality — RCAT POS

- Review docs/ROADMAP.md and issue acceptance criteria before implementation.
- Prefer scoped Nx affected lint/test/build checks; always run mandatory shared security/schema/payment tests when their boundaries can be impacted.
- Pin Node/pnpm/lockfile only when scaffolding creates actual packages; maintain a reproducible clean-install job.
- Separate cheap PR checks, integration tests with ephemeral DB and deployment workflows.
- No deploy from unreviewed PR, no real production secrets in CI, least-privilege GitHub Actions permissions.
- Keep workflow triggers and caching deliberate; no duplicate full test matrices for tiny docs changes.
- Provide coverage of domain failure cases, migration/rollback, idempotency, tenant isolation and payment webhooks.
- Always publish logs/evidence and identify skipped/not-yet-implemented checks; never report skipped checks as passed.
- Preserve main branch integrity using PRs, review and protections when available.

