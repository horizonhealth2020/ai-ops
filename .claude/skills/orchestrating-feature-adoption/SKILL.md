7 files created at `.claude/skills/orchestrating-feature-adoption/`:

- **SKILL.md** — quick start with activation state builder, nudge injection, and vertical feature discovery patterns
- **references/activation-onboarding.md** — onboarding entry point, activation checklist schema, `buildActivationState()`, WARNING against Redis-only activation state
- **references/engagement-adoption.md** — adoption signal SQL queries, tier-based feature unlocks, returning caller feature, WARNING against hardcoded feature flag lists
- **references/in-app-guidance.md** — `nudgeBuilder.js` utility, standard nudge shape convention, wallet soft-lock guidance, WARNING against inline nudge logic in routes
- **references/product-analytics.md** — WARNING for missing analytics SDK, structured logging as analytics, adoption funnel SQL queries, booking conversion rate queries
- **references/roadmap-experiments.md** — `feature_flags` JSONB pattern, vertical-scoped rollouts, WARNING against experiment state in Redis, full rollout checklist
- **references/feedback-insights.md** — call outcome signals, FSM rejection pattern tracking, n8n fire-and-forget pattern, WARNING against silent FSM failures, structured feedback loop checklist