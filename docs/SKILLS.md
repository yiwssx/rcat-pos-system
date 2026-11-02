# Agent Skills — RCAT POS

## Installation status (2026-11-02)

Five project-authored skills were already present; a sixth project-specific POS UX design skill has now been added. Eleven additional **source-pinned upstream skills or attributed adaptations** are vendored as read-only Markdown and reference files into `.agents/skills/`. This is a repository-local installation for compatible coding agents, **not** a ChatGPT plugin installation or Node package install.

| Skill | Source | Purpose | License |
|---|---|---|---|
| [`angular-developer`](../.agents/skills/angular-developer/SKILL.md) | [angular/skills](https://github.com/angular/skills/tree/2a2b801eb9bf3304424ddedfa1ace347e1fff6a6) | Angular architecture, Signals, routing, forms, UI and SSR | MIT |
| [`angular-new-app`](../.agents/skills/angular-new-app/SKILL.md) | [angular/skills](https://github.com/angular/skills/tree/2a2b801eb9bf3304424ddedfa1ace347e1fff6a6) | Angular app scaffolding (coordinate with Nx generators) | MIT |
| [`nx-workspace`](../.agents/skills/nx-workspace/SKILL.md) | [nrwl/nx-ai-agents-config](https://github.com/nrwl/nx-ai-agents-config/tree/13282936b5f6aa53e3d41ba589a4a2dc0d6f5786) | Monorepo project graph and affected analysis | MIT |
| [`nx-run-tasks`](../.agents/skills/nx-run-tasks/SKILL.md) | [nrwl/nx-ai-agents-config](https://github.com/nrwl/nx-ai-agents-config/tree/13282936b5f6aa53e3d41ba589a4a2dc0d6f5786) | Nx build/test/lint tasks | MIT |
| [`nx-generate`](../.agents/skills/nx-generate/SKILL.md) | [nrwl/nx-ai-agents-config](https://github.com/nrwl/nx-ai-agents-config/tree/13282936b5f6aa53e3d41ba589a4a2dc0d6f5786) | Nx application and library generators | MIT |
| [`supabase-postgres-best-practices`](../.agents/skills/supabase-postgres-best-practices/SKILL.md) | [supabase/agent-skills](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7) | PostgreSQL schema, indexing, migrations, RLS and transactions | MIT |
| [`playwright-cli`](../.agents/skills/playwright-cli/SKILL.md) | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli/tree/c2d8d199459d1480491bebf0a6b3587136b673fa) | Browser-based end-to-end workflow testing | Apache-2.0 |
| [`security-review`](../.agents/skills/security-review/SKILL.md) | [getsentry/skills](https://github.com/getsentry/skills/tree/d12f250460ffd961f549dbebf7eeb0cf4afd4c2e) | High-confidence security review, including API and business-logic flaws | Apache-2.0 + OWASP CC BY-SA 4.0 |

| [`frontend-design`](../.agents/skills/frontend-design/SKILL.md) | [anthropics/skills](https://github.com/anthropics/skills/tree/ca45fc496a3436251f191354091d557da31c15b5) | Distinctive, intentional frontend visual design, visual direction, typography and layout | Apache-2.0 |
| [`web-ui-review`](../.agents/skills/web-ui-review/SKILL.md) | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines/tree/434b7f91364665f2f733b310ec54809bf8f37937) | Adapted Angular/mobile POS interface audit based on Vercel Web Interface Guidelines | MIT |
| [`design-system`](../.agents/skills/design-system/SKILL.md) | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/3a13158ff1f32156cbe144108de48eda2ecaed9a) | Adapted Angular POS design-token and component-state architecture with source-pinned reference files | MIT |

## Original project skills

- `angular-frontend`: RCAT UI architecture, mobile-first merchant/guest experiences
- `nestjs-backend`: NestJS API domains, transactions and modular monolith
- `payment-integrity`: Thai payments, verified webhooks, refunds and reconciliation
- `tenant-security`: tenant isolation, authentication, RBAC and QR safety
- `ci-quality`: repository checks, CI affected runs and release gates
- `pos-ux-design`: Thai QR ordering, payment trust, tablet merchant operations, adverse-state UX

## Design guidance

Read `docs/DESIGN-SYSTEM.md` for the draft design brief. `frontend-design` is the original upstream skill; `web-ui-review` and `design-system` are project-adapted skills with pinned reference snapshots and attribution. The authoritative workflow rules are in `pos-ux-design`; imported skills must not override payments, tenant security or functional correctness. Review and approve visual direction before implementation. No UI screens, Figma files or runtime dependencies were installed by this change.

## Sources, pins, and attribution

The full upstream commit pins are recorded in [skills-manifest.json](skills-manifest.json). Each vendored/adapted skill contains an `UPSTREAM.md` and relevant license notices. Bundled reference documents are copied with the skill, not fetched silently at runtime. All upstream instructions remain subject to `AGENTS.md` and project decisions. Never run unfamiliar external commands without review.

## Updating safely

1. Read the upstream repository's current license and release/commit history; verify owner and source.
2. Compare with the pinned commit in `skills-manifest.json`; inspect every changed `SKILL.md`, reference, and script.
3. Do not auto-install from unaudited links, and never execute scripts bundled with a skill automatically.
4. Copy Markdown/reference updates on a new PR; update `UPSTREAM.md`, commit pins, and attribution.
5. Validate skill names, local references, and foundation CI. For framework docs, ensure the guidance matches the actual application version.

## Limitations

- No application workspace or test runner has yet been installed. See issues #2 and #10.
- `playwright-cli` here is an *instruction skill only*; install and pin `@playwright/cli` when browser testing is introduced, not now.
- Nx guidance applies once the Nx workspace is bootstrapped.
- No payment gateway is chosen or connected by these skills; `payment-integrity` remains the controlling domain guidance.
- Angular's upstream `angular-new-app` recommendations must yield to the project's Nx monorepo decision.
