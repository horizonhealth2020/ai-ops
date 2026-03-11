'use strict';

const router = require('express').Router();
const { vapiAuth } = require('../middleware/auth');
const { getTransferConfig } = require('../services/transferService');
const { deductCallCost } = require('../services/walletService');
const { releaseCallHolds } = require('../services/availabilityService');
const { fireN8nWebhook } = require('../services/bookingService');
const pool = require('../config/database');
const logger = require('../utils/logger');

/**
 * POST /api/v1/call/transfer
 * Look up transfer config for a client.
 */
router.post('/transfer', vapiAuth, async (req, res, next) => {
  try {
    const { client_id, reason } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const config = await getTransferConfig(client_id);

    if (!config.transfer_to) {
      return res.json({
        action: 'fallback',
        fallback: config.fallback,
        message: 'No transfer number configured. Taking a message instead.',
      });
    }

    res.json({
      action: 'transfer',
      transfer_to: config.transfer_to,
      whisper_msg: config.whisper_msg,
      fallback: config.fallback,
      reason: reason || 'caller_requested',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/call/complete
 * Log call, release holds, deduct wallet.
 */
router.post('/complete', vapiAuth, async (req, res, next) => {
  try {
    const {
      client_id, call_id, caller_phone, caller_name,
      duration_seconds, intent, outcome, transcript_summary,
      recording_url, booking_id, raw_data,
    } = req.body;

    if (!client_id || !call_id) {
      return res.status(400).json({ error: 'client_id and call_id are required' });
    }

    // 1. Log to call_logs
    await pool.query(
      `INSERT INTO call_logs (
         call_id, client_id, caller_phone, caller_name, duration_seconds,
         intent, outcome, booking_id, transcript_summary, recording_url, raw_data
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (call_id) DO UPDATE SET
         duration_seconds = EXCLUDED.duration_seconds,
         intent = EXCLUDED.intent,
         outcome = EXCLUDED.outcome,
         transcript_summary = EXCLUDED.transcript_summary,
         recording_url = EXCLUDED.recording_url,
         raw_data = EXCLUDED.raw_data`,
      [call_id, client_id, caller_phone, caller_name,
       duration_seconds || 0, intent, outcome, booking_id,
       transcript_summary, recording_url,
       raw_data ? JSON.stringify(raw_data) : null]
    );

    // 2. Release any Redis holds for this call
    await releaseCallHolds(call_id);

    // 3. Deduct wallet balance
    let walletResult = null;
    if (duration_seconds && duration_seconds > 0) {
      walletResult = await deductCallCost(client_id, duration_seconds, call_id);
    }

    // 4. Fire n8n webhook (fire-and-forget)
    fireN8nWebhook('call-completed', {
      call_id,
      client_id,
      caller_phone,
      duration_seconds,
      intent,
      outcome,
      booking_id,
      wallet_deducted: walletResult?.cost_cents || 0,
    });

    logger.info('Call completed', {
      client_id,
      call_id,
      duration_seconds,
      intent,
      outcome,
      wallet_cost: walletResult?.cost_cents,
    });

    res.json({
      status: 'logged',
      call_id,
      wallet: walletResult ? {
        cost_cents: walletResult.cost_cents,
        balance_after_cents: walletResult.balance_after_cents,
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
