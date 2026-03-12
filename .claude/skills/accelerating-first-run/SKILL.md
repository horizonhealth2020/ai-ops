7 files created. Here's a summary:

**`.claude/skills/accelerating-first-run/`**

- **SKILL.md** — Quick reference covering the full onboard → first-call activation path, with patterns for completeness scoring, n8n post-onboard webhooks, and first-call milestone detection
- **references/conversion-optimization.md** — Minimum viable onboard payload, wallet top-up conversion, activation checklist, and the silent-wallet-empty-state anti-pattern
- **references/content-copy.md** — Where copy lives (JSON payloads only — no HTML), onboard 201 response guidance, dashboard setup hints, and vertical-specific greeting scripts for HVAC/spa/plumbing
- **references/distribution.md** — n8n as the distribution layer with fire-and-forget webhook pattern, progressive onboarding via the existing `PUT /dashboard/*` endpoints, and vertical-based acquisition paths
- **references/measurement-testing.md** — Activation funnel SQL queries, time-to-first-call distribution, onboarding regression test patterns, and a WARNING about the missing `activation_events` table
- **references/growth-engineering.md** — Activation loop architecture, returning-caller recognition as a retention hook, FAQ seeding for first-call quality, and the first-call milestone detection anti-pattern
- **references/strategy-monetization.md** — Wallet tier strategy, onboard-to-paid conversion flow, low-balance intervention pattern, tier upgrade triggers based on monthly spend, and the default-to-standard anti-pattern with a vertical-based fix