'use strict';

const pool = require('../config/database');
const logger = require('../utils/logger');

// Tier pricing: cents per minute
const TIER_RATES = {
  standard: 40,
  growth: 32,
  scale: 27,
  enterprise: 23,
};

/**
 * Check if client wallet has sufficient balance.
 * @param {string} clientId
 * @returns {boolean}
 */
async function checkBalance(clientId) {
  const result = await pool.query(
    'SELECT balance_cents FROM wallets WHERE client_id = $1',
    [clientId]
  );
  if (result.rows.length === 0) return true; // No wallet = no restriction
  return result.rows[0].balance_cents > 0;
}

/**
 * Deduct call cost from wallet based on duration and tier.
 *
 * @param {string} clientId
 * @param {number} durationSeconds
 * @param {string} callId - reference for transaction
 * @returns {object} { success, cost_cents, balance_after_cents }
 */
async function deductCallCost(clientId, durationSeconds, callId) {
  // Get wallet
  const walletResult = await pool.query(
    'SELECT id, balance_cents, tier FROM wallets WHERE client_id = $1',
    [clientId]
  );

  if (walletResult.rows.length === 0) {
    return { success: true, cost_cents: 0, balance_after_cents: 0 };
  }

  const wallet = walletResult.rows[0];
  const rate = TIER_RATES[wallet.tier] || TIER_RATES.standard;
  const minutes = Math.ceil(durationSeconds / 60);
  const costCents = minutes * rate;

  // Atomic deduction — only succeeds if balance is sufficient
  const updateResult = await pool.query(
    `UPDATE wallets
     SET balance_cents = balance_cents - $1, updated_at = NOW()
     WHERE client_id = $2 AND balance_cents >= $1
     RETURNING balance_cents`,
    [costCents, clientId]
  );

  if (updateResult.rows.length === 0) {
    // Insufficient balance — deduct what's available
    const fallbackResult = await pool.query(
      `UPDATE wallets
       SET balance_cents = 0, updated_at = NOW()
       WHERE client_id = $1
       RETURNING balance_cents`,
      [clientId]
    );

    const balanceAfter = fallbackResult.rows[0]?.balance_cents ?? 0;

    // Log transaction
    await pool.query(
      `INSERT INTO wallet_transactions (wallet_id, client_id, type, amount_cents, balance_after_cents, description, reference_id)
       VALUES ($1, $2, 'usage', $3, $4, $5, $6)`,
      [wallet.id, clientId, -wallet.balance_cents, balanceAfter,
       `Call usage: ${minutes} min @ ${rate}¢/min (partial)`, callId]
    );

    return { success: true, cost_cents: wallet.balance_cents, balance_after_cents: balanceAfter };
  }

  const balanceAfter = updateResult.rows[0].balance_cents;

  // Log transaction
  await pool.query(
    `INSERT INTO wallet_transactions (wallet_id, client_id, type, amount_cents, balance_after_cents, description, reference_id)
     VALUES ($1, $2, 'usage', $3, $4, $5, $6)`,
    [wallet.id, clientId, -costCents, balanceAfter,
     `Call usage: ${minutes} min @ ${rate}¢/min`, callId]
  );

  // Check auto-reload threshold
  if (wallet.auto_reload_enabled && balanceAfter < (wallet.auto_reload_threshold_cents || 500)) {
    logger.info('Wallet below auto-reload threshold', {
      client_id: clientId, balance: balanceAfter,
      threshold: wallet.auto_reload_threshold_cents,
    });
    // Auto-reload would trigger Stripe charge here — deferred to payment phase
  }

  return { success: true, cost_cents: costCents, balance_after_cents: balanceAfter };
}

/**
 * Get wallet info for a client.
 */
async function getWalletInfo(clientId) {
  const result = await pool.query(
    `SELECT w.*,
       (SELECT json_agg(wt ORDER BY wt.created_at DESC)
        FROM (SELECT * FROM wallet_transactions WHERE client_id = $1 ORDER BY created_at DESC LIMIT 20) wt
       ) AS recent_transactions
     FROM wallets w WHERE w.client_id = $1`,
    [clientId]
  );
  return result.rows[0] || null;
}

module.exports = { checkBalance, deductCallCost, getWalletInfo, TIER_RATES };
