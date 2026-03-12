Three files created at `.claude/skills/stripe/`:

**SKILL.md** — Quick reference with the key patterns: per-client credential loading, `paymentService` routing, and the cents-only rule.

**references/patterns.md** — Covers:
- Currency safety (cents always, no floats)
- Per-client vs platform key credential loading
- Why to always go through `paymentService` not the integration directly
- Mandatory `payments` table insert after intent creation
- WARNING against putting webhook handling in Express (belongs in n8n)
- Always including `client_id` in Stripe metadata

**references/workflows.md** — Covers:
- Full call-time payment creation flow (Vapi → Express → Stripe → DB → SMS)
- How to add Stripe to a new client (encrypted credentials insert)
- Dual-path routing decision tree
- New feature checklist (7 items)
- Payment state validation queries
- WARNING against module-level Stripe singleton (breaks multi-tenant)