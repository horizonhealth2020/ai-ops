3 files created at `.claude/skills/pgvector/`:

- **SKILL.md** — quick start with the actual `searchFaqs` call, `buildPrompt` injection, and direct FAQ insert; key concept table covering operator, threshold, index type, and tenant isolation
- **references/patterns.md** — schema/index setup from `migrations/010`, embedding generation, cosine query with the `<=>` operator, multi-tenant isolation DO/DON'T pair, and two WARNINGs (missing `::vector` cast, mixed embedding models)
- **references/workflows.md** — live-call injection flow, seeding with embeddings, dashboard FAQ creation route, full re-embed script, and a copy-paste checklist for adding FAQ search to a new route