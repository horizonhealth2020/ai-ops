'use strict';

const pool = require('../pool');

async function insert({ client_id, call_id, caller_number, outcome, summary, duration_seconds }) {
  await pool.query(
    `INSERT INTO call_logs (client_id, call_id, caller_number, outcome, summary, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [client_id, call_id, caller_number || null, outcome || null, summary || null, duration_seconds || null]
  );
}

async function findByClient(clientId, { limit = 50, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT id, call_id, caller_number, outcome, summary, duration_seconds, created_at
     FROM call_logs
     WHERE client_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [clientId, limit, offset]
  );
  return result.rows;
}

module.exports = { insert, findByClient };
