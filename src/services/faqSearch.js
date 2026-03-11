'use strict';

const pool = require('../config/database');
const OpenAI = require('openai');
const env = require('../config/env');

let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient && env.openaiApiKey) {
    openaiClient = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return openaiClient;
}

/**
 * Generate embedding for a text query using OpenAI.
 */
async function generateEmbedding(text) {
  const client = getOpenAIClient();
  if (!client) return null;

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Search FAQ embeddings for a client using pgvector similarity.
 *
 * @param {string} clientId - UUID
 * @param {string} query - user's message to search against
 * @param {number} limit - max results (default 5)
 * @returns {Array} matching FAQ entries
 */
async function searchFaqs(clientId, query, limit = 5) {
  try {
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
  } catch {
    return [];
  }
}

module.exports = { searchFaqs };
