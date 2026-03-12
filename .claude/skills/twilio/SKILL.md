Three files created at `.claude/skills/twilio/`:

- **SKILL.md** — quick start with `sendSms`/`sendPaymentLink`, key concepts table, graceful degradation pattern
- **references/patterns.md** — lazy client init, E.164 enforcement, multi-tenant safety (platform vs per-client), two WARNING sections (swallowing errors that crash payment flow, logging PII)
- **references/workflows.md** — payment link SMS flow diagram, checklist for adding new notification types, n8n handoff for async notifications, testing without real SMS, Twilio error code table

Key decisions documented: SMS is fire-and-forget (never propagates), Twilio is platform-level (not per-client like Stripe/Square), and `sendSms` re-throws while callers swallow — keeping the transport layer dumb.