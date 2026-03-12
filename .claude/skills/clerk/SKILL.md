3 files created at `.claude/skills/clerk/`:

- **SKILL.md** — quick reference with middleware usage, key concept table, and common patterns
- **references/patterns.md** — `verifyToken` internals, `client_id` extraction, middleware placement, two WARNING anti-patterns (body client_id bypass, applying clerkAuth to Vapi routes), and error response shapes
- **references/workflows.md** — copyable checklist for new protected routes, onboarding tenant-linking flow with iterate-until-pass validation, and a debugging guide for all three failure modes (401 missing, 401 invalid, 403 no client_id)