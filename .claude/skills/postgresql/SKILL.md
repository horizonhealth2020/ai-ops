Generated 3 files in `.claude/skills/postgresql/`:

**SKILL.md** — Quick reference with 5 code examples covering: PgBouncer pool queries, atomic balance deduction, pgvector search, new migration pattern, and RETURNING inserts.

**references/patterns.md** — Deep dives on:
- Connection setup (why two URLs: PgBouncer vs direct)
- Multi-tenant isolation with real callerMemory.js example
- Schema conventions (UUID PKs, TIMESTAMPTZ, JSONB, BYTEA)
- Currency in cents with the atomic overdraft-safe UPDATE pattern
- Two anti-patterns with full WARNING format: missing `client_id` filter and string interpolation

**references/workflows.md** — Step-by-step workflows for:
- Adding a new migration (with the "NEVER modify existing files" warning)
- The 3-phase booking flow (check → hold → confirm) showing how Redis and PostgreSQL coordinate
- Wallet deduction with audit trail (two-write consistency pattern)
- Health check query
- A copyable checklist for any new feature with DB changes, including a feedback loop for iterating until migrations run clean