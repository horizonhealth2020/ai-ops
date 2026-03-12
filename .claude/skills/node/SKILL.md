Skill files written to `.claude/skills/node/`:

- **SKILL.md** — Quick-start patterns (route handler, env validation, graceful shutdown), key concepts table, multi-tenant guard and parallel I/O patterns
- **references/patterns.md** — Async/await conventions, atomic Redis SETNX, WARNINGs for event loop blocking, mutable module state, and missing input validation library (zod recommendation)
- **references/types.md** — Money-as-cents rules, E.164 phone formatting, client config shape, Redis JSON serialization
- **references/modules.md** — Static vs lazy `require`, service layer structure, fail-fast env config, circular dependency prevention, raw-pg SQL injection mitigation, new route checklist
- **references/errors.md** — Global error handler pattern, HTTP status classification, WARNINGs for leaking internal errors and swallowing errors silently, PgBouncer prepared-statement fix, external API timeout pattern