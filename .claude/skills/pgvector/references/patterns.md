# pgvector Patterns Reference

## Contents
- Schema and index setup
- Embedding generation
- Cosine similarity query
- Multi-tenant isolation
- Anti-patterns

---

## Schema and Index Setup

The `faq_embeddings` table uses `VECTOR(1536)` — sized to match OpenAI's `text-embedding-3-small`.
The IVFFlat index uses cosine ops to match the `<=>` operator used in queries.

```sql
-- migrations/010_create_faq_embeddings.sql
CREATE TABLE faq_embeddings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  embedding  VECTOR(1536) NOT NULL,
  category   VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_faq_embeddings_client ON faq_embeddings(client_id);
CREATE INDEX idx_faq_embeddings_vector
  ON faq_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**IVFFlat tuning:** `lists = 100` is appropriate for up to ~1M rows per table. If a tenant has
>100k FAQ rows, increase `lists`. If search recall degrades, run `VACUUM ANALYZE faq_embeddings`
and consider rebuilding the index.

---

## Embedding Generation

Always use `text-embedding-3-small` — it produces 1536-dimensional vectors, matching the column
definition. NEVER switch models without running a full re-embedding of all rows; mixed-model
embeddings produce meaningless similarity scores.

```javascript
// src/services/faqSearch.js
async function generateEmbedding(text) {
  const client = getOpenAIClient();
  if (!client) return null;

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0].embedding;  // float[] of length 1536
}
```

See the **openai** skill for client initialization and API key validation.

---

## Cosine Similarity Query

The `<=>` operator returns cosine **distance** (0 = identical, 2 = opposite). Convert to
similarity with `1 - distance` for human-readable scores.

```javascript
// src/services/faqSearch.js
async function searchFaqs(clientId, query, limit = 5) {
  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  const vectorStr = `[${embedding.join(',')}]`;

  const result = await pool.query(
    `SELECT question, answer, category,
            1 - (embedding <=> $1::vector) AS similarity
     FROM faq_embeddings
     WHERE client_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vectorStr, clientId, limit]
  );

  return result.rows.filter(r => r.similarity > 0.3);
}
```

**Why filter in JS, not SQL:** The `WHERE 1 - (embedding <=> $1) > 0.3` pattern forces PostgreSQL
to compute cosine distance for every row before applying the threshold, defeating the index.
Fetch `LIMIT N` via the index, then filter in application code.

---

## Multi-Tenant Isolation

NEVER omit `client_id` from FAQ queries. The `idx_faq_embeddings_client` B-tree index ensures
the planner scans only the tenant's rows before the vector index kicks in.

```javascript
// GOOD - always scope to client_id
const result = await pool.query(
  `SELECT question, answer, 1 - (embedding <=> $1::vector) AS similarity
   FROM faq_embeddings
   WHERE client_id = $2
   ORDER BY embedding <=> $1::vector
   LIMIT $3`,
  [vectorStr, clientId, 5]
);
```

```javascript
// BAD - cross-tenant data leak
const result = await pool.query(
  `SELECT question, answer FROM faq_embeddings
   ORDER BY embedding <=> $1::vector LIMIT 5`,
  [vectorStr]
);
```

See the **postgresql** skill for PgBouncer connection setup.

---

## WARNING: Wrong Cast Syntax

### The Problem

```javascript
// BAD - missing ::vector cast, silently passes a string
await pool.query(
  'SELECT * FROM faq_embeddings ORDER BY embedding <=> $1 LIMIT 5',
  [`[${embedding.join(',')}]`]
);
```

**Why This Breaks:**
1. PostgreSQL receives a plain `text` literal; the `<=>` operator expects `vector` type
2. Query fails at runtime with `ERROR: operator does not exist: vector <=> text`
3. The error surfaces as an empty result (current code catches all errors and returns `[]`),
   making it look like "no FAQs found" instead of a hard failure

**The Fix:**

```javascript
// GOOD - explicit ::vector cast
await pool.query(
  'SELECT * FROM faq_embeddings ORDER BY embedding <=> $1::vector LIMIT 5',
  [`[${embedding.join(',')}]`]
);
```

---

## WARNING: Mixed Embedding Models

### The Problem

```javascript
// BAD - switching model mid-operation
const response = await client.embeddings.create({
  model: 'text-embedding-ada-002',  // Different from stored embeddings
  input: text,
});
```

**Why This Breaks:**
1. `ada-002` produces 1536 dimensions but in a different semantic space than `text-embedding-3-small`
2. Cosine similarity scores become meaningless — unrelated FAQs appear as top matches
3. No runtime error; silent quality degradation that's hard to detect

**The Fix:** Always use `text-embedding-3-small`. If changing models, re-embed all rows in a
migration before deploying.
