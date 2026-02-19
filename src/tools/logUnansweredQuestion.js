'use strict';

const pool = require('../db/pool');

const toolDef = {
  name: 'log_unanswered_question',
  description: 'Log a question the AI could not answer so the client team can review and update their FAQ or training data.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The exact question or topic the caller asked about',
      },
      context: {
        type: 'string',
        description: 'Brief context about why this could not be answered',
      },
    },
    required: ['question'],
  },
};

async function execute({ question, context }, client) {
  try {
    await pool.query(
      `INSERT INTO call_logs (client_id, call_id, outcome, summary)
       VALUES ($1, $2, 'unanswered_question', $3)`,
      [client.id, `uq-${Date.now()}`, `Q: ${question}${context ? ` | Context: ${context}` : ''}`]
    );
  } catch (err) {
    // Non-fatal — don't disrupt the call flow
    console.error('Failed to log unanswered question:', err.message);
  }

  return {
    logged: true,
    message: "I've made a note of that question so our team can follow up. Is there anything else I can help you with today?",
  };
}

module.exports = { execute, toolDef };
