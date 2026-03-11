'use strict';

const pool = require('../config/database');

/**
 * Look up caller history by phone number for a specific client.
 * Returns context about returning callers.
 *
 * @param {string} clientId - UUID
 * @param {string} callerPhone - E.164 phone number
 * @returns {object|null} caller context
 */
async function lookupCaller(clientId, callerPhone) {
  if (!callerPhone) return null;

  const result = await pool.query(
    `SELECT
       caller_name,
       COUNT(*) AS previous_calls,
       MAX(created_at) AS last_call_at,
       (SELECT intent FROM call_logs WHERE client_id = $1 AND caller_phone = $2 ORDER BY created_at DESC LIMIT 1) AS last_intent,
       (SELECT outcome FROM call_logs WHERE client_id = $1 AND caller_phone = $2 ORDER BY created_at DESC LIMIT 1) AS last_outcome
     FROM call_logs
     WHERE client_id = $1 AND caller_phone = $2
     GROUP BY caller_name
     ORDER BY MAX(created_at) DESC
     LIMIT 1`,
    [clientId, callerPhone]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    caller_name: row.caller_name,
    previous_calls: parseInt(row.previous_calls, 10),
    last_call_at: row.last_call_at,
    last_intent: row.last_intent,
    last_outcome: row.last_outcome,
  };
}

module.exports = { lookupCaller };
