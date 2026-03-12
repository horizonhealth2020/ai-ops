7 files created in `.claude/skills/designing-onboarding-paths/`:

- **SKILL.md** — overview, quick-start patterns, key concepts, related skills
- **references/activation-onboarding.md** — `onboarding_step` schema, provisioning flow in `onboard.js`, activation gate state machine, transaction anti-pattern
- **references/engagement-adoption.md** — adoption signals from `call_logs`/`bookings`, low-wallet nudge, FSM/FAQ nudges, performance anti-patterns
- **references/in-app-guidance.md** — standard guidance block shape, empty state structure, setup checklist endpoint, blocking vs informational severity levels
- **references/product-analytics.md** — `product_events` table, funnel event list, activation metric SQL queries, async-fire anti-pattern
- **references/roadmap-experiments.md** — `feature_flags` JSONB column, tier-based rollout, persona A/B testing without a flag service, experiment validation loop
- **references/feedback-insights.md** — call outcome logging, FSM rejection rate signal, low-balance churn trigger via n8n, insight caching anti-pattern