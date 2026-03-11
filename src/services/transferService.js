'use strict';

const pool = require('../config/database');

/**
 * Get transfer configuration for a client.
 *
 * @param {string} clientId - UUID
 * @returns {object} { transfer_to, whisper_msg, fallback }
 */
async function getTransferConfig(clientId) {
  const result = await pool.query(
    `SELECT transfer_number, transfer_name, transfer_fallback, angry_handling
     FROM clients WHERE id = $1`,
    [clientId]
  );

  if (result.rows.length === 0) {
    return { transfer_to: null, whisper_msg: null, fallback: 'take_message' };
  }

  const client = result.rows[0];
  return {
    transfer_to: client.transfer_number,
    whisper_msg: client.transfer_name
      ? `Incoming call transfer from AI agent. ${client.transfer_name} requested.`
      : 'Incoming call transfer from AI agent.',
    fallback: client.transfer_fallback || 'take_message',
  };
}

module.exports = { getTransferConfig };
