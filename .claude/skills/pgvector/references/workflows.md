# pgvector Workflows Reference

## Contents
- Live-call FAQ injection workflow
- Seeding FAQs with embeddings
- Adding a new FAQ via dashboard
- Re-embedding all rows after model change
- Checklist: adding FAQ search to a new route

---

## Live-Call FAQ Injection Workflow

The FAQ search runs inside the Vapi route on every inbound call, between tenant resolution and
prompt assembly. The result is injected directly into the system prompt.

```javascript
// src/routes/vapi.js (conceptual flow)
const { searchFaqs } = require('../services/faqSearch');
const { buildPrompt } = require('../services/promptBuilder');

// 1. Caller message arrives in Vapi request body
const callerMessage = req.body.messages?.at(-1)?.content ?? '';

// 2. Run vector search scoped to this tenant
const faqResults = await searchFaqs(req.clientId, callerMessage, 5);

// 3. Inject into prompt — promptBuilder handles formatting
const systemPrompt = buildPrompt(req.client, { faqResults, callerContext });
```

The search adds ~150ms (embedding API) + ~30ms (PgBouncer query) to the call. This is
acceptable for live calls; do NOT add caching of individual search results as they are
query-dependent.

See the **vapi** skill for the full SSE streaming context.

---

## Seeding FAQs with Embeddings

When onboarding a new client, embed their FAQ data during the seeding step. Generate embeddings
in batches to avoid rate limits.

```javascript
// scripts/seed.js (or a standalone import script)
const OpenAI = require('openai');
const { Pool } = require('pg');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); // migrations use direct URL

const faqs = [
  { question: 'What are your hours?', answer: 'Mon–Fri 8am–6pm', category: 'general' },
  { question: 'Do you offer emergency service?', answer: 'Yes, 24/7 for existing customers', category: 'service' },
];

for (const faq of faqs) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: faq.question,
  });
  const vectorStr = `[${response.data[0].embedding.join(',')}]`;

  await pool.query(
    `INSERT INTO faq_embeddings (client_id, question, answer, embedding, category)
     VALUES ($1, $2, $3, $4::vector, $5)`,
    [clientId, faq.question, faq.answer, vectorStr, faq.category]
  );
}
```

**Embed the question, not the answer.** The caller's message is compared to the question text.
The answer is retrieved but never embedded.

---

## Adding a New FAQ via Dashboard

When a client adds a FAQ through the dashboard route, generate and store the embedding inline.

```javascript
// src/routes/dashboard.js
router.post('/faq', requireClerkAuth, async (req, res, next) => {
  try {
    const { question, answer, category } = req.body;
    const { clientId } = req;

    // Generate embedding for the question text
    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: question,
    });
    const vectorStr = `[${response.data[0].embedding.join(',')}]`;

    const result = await pool.query(
      `INSERT INTO faq_embeddings (client_id, question, answer, embedding, category)
       VALUES ($1, $2, $3, $4::vector, $5)
       RETURNING id, question, category, created_at`,
      [clientId, question, answer, vectorStr, category ?? null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
```

See the **express** skill for `requireClerkAuth` middleware usage.

---

## Re-Embedding All Rows After Model Change

NEVER mix embeddings from different models in the same table. If you change the embedding model,
run this migration before deploying any code that uses the new model.

```javascript
// scripts/reembed.js — run once, then delete
'use strict';

const OpenAI = require('openai');
const { Pool } = require('pg');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function reembedAll() {
  const { rows } = await pool.query('SELECT id, question FROM faq_embeddings ORDER BY created_at');

  for (const row of rows) {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: row.question,
    });
    const vectorStr = `[${response.data[0].embedding.join(',')}]`;

    await pool.query(
      'UPDATE faq_embeddings SET embedding = $1::vector WHERE id = $2',
      [vectorStr, row.id]
    );
  }

  console.log(`Re-embedded ${rows.length} rows`);
}

reembedAll().catch(console.error).finally(() => pool.end());
```

Validate: spot-check similarity scores after re-embedding before promoting to production.

---

## Checklist: Adding FAQ Search to a New Route

Copy this checklist and track progress:

- [ ] Import `searchFaqs` from `src/services/faqSearch`
- [ ] Extract caller's message from request body
- [ ] Call `searchFaqs(clientId, callerMessage, limit)` — always pass `clientId`
- [ ] Pass results as `faqResults` to `buildPrompt()` or handle inline
- [ ] Verify `OPENAI_API_KEY` is set in the environment (search silently returns `[]` if not)
- [ ] Test with a query that has a known high-similarity FAQ match
- [ ] Test with a nonsense query — should return `[]`, not throw
- [ ] Confirm `client_id` filter is present in the SQL (grep for `WHERE client_id`)

---

## WARNING: Silent Failures in faqSearch

The current `searchFaqs` implementation catches all errors and returns `[]`. This is intentional
for live-call resilience — a broken FAQ search should never fail a call. However, it means
embedding API errors, PgBouncer timeouts, and bad vector casts all look identical to "no results."

Add structured logging when modifying `faqSearch.js` to make failures observable:

```javascript
// Improved error handling
} catch (err) {
  logger.error('FAQ search failed', {
    client_id: clientId,
    error: err.message,
    query: query.slice(0, 100),
  });
  return [];
}
```

See the **node** skill for `logger` usage conventions.
