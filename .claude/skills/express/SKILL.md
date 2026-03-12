All 6 files generated. Here's a summary of what was created:

**`.claude/skills/express/`**

| File | Purpose |
|------|---------|
| `SKILL.md` | Quick reference — route skeleton, key concepts, common patterns |
| `references/routes.md` | Route structure, validation, pagination, rate limiting, anti-patterns |
| `references/services.md` | Service layer contract, cache-aside, transactions, parallel queries, currency rules |
| `references/database.md` | PgBouncer connection, parameterized queries, tenant isolation, upsert, N+1 prevention |
| `references/auth.md` | `vapiAuth` vs `clerkAuth`, application patterns, rate limiting, new route checklist |
| `references/errors.md` | Global error handler, `next(err)` contract, status codes, structured logging, anti-patterns |

All code examples are drawn directly from your actual codebase (`src/routes/`, `src/middleware/`, `src/index.js`). The skill will trigger correctly for route/middleware work in this project.