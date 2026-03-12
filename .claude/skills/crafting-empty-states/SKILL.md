7 files created at `.claude/skills/crafting-empty-states/`:

- **SKILL.md** — Quick start patterns: empty state response shape, onboarding checklist, wallet gate, with links to all references
- **references/activation-onboarding.md** — Onboard entry point, 4-step activation checklist, Vapi readiness gate, caching guidance
- **references/engagement-adoption.md** — Feature adoption signals, wallet nudges, tier upgrade nudges (integer cents), FSM adoption tracking
- **references/in-app-guidance.md** — Consistent guidance object shape, contextual help per endpoint, error-to-guidance mapping, severity levels
- **references/product-analytics.md** — Activation event logging via structured logger, empty state impression tracking, funnel queries against `call_logs`
- **references/roadmap-experiments.md** — Feature flag pattern via JSONB column, vertical-based A/B, `scripts/enable_flag.js` rollout, validation checklist
- **references/feedback-insights.md** — Call outcome logging, FSM rejection patterns, wallet depletion → n8n trigger, fire-and-forget webhook pattern