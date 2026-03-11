'use strict';

const router = require('express').Router();
const { clerkAuth } = require('../middleware/auth');
const pool = require('../config/database');
const { loadClientFromDb, invalidateCache } = require('../middleware/tenantResolver');
const { getWalletInfo } = require('../services/walletService');
const promptCompiler = require('../services/promptCompiler');

// All dashboard routes require Clerk auth
router.use(clerkAuth);

/**
 * GET /api/v1/dashboard/config
 * Return full client config (client + hours + scheduling + appointment_types + agent settings).
 */
router.get('/config', async (req, res, next) => {
  try {
    const client = await loadClientFromDb(req.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    res.json({
      business_name: client.business_name,
      business_phone: client.business_phone,
      vertical: client.vertical,
      timezone: client.timezone,
      business_description: client.business_description,
      service_area: client.service_area,
      agent_name: client.agent_name,
      agent_voice: client.agent_voice,
      greeting_script: client.greeting_script,
      tone_tags: client.tone_tags,
      phrases_use: client.phrases_use,
      phrases_avoid: client.phrases_avoid,
      transfer_phone: client.transfer_phone,
      angry_handling: client.angry_handling,
      after_hours_behavior: client.after_hours_behavior,
      business_hours: client.business_hours,
      scheduling_config: client.scheduling_config,
      appointment_types: client.appointment_types,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/dashboard/hours
 * Replace all business_hours rows (DELETE + INSERT 7 rows).
 * Recompiles system prompt and invalidates cache.
 *
 * Body: { hours: [{ day_of_week, is_open, open_time, close_time, after_hours_mode }] }
 */
router.put('/hours', async (req, res, next) => {
  try {
    const { hours } = req.body;
    if (!Array.isArray(hours) || hours.length !== 7) {
      return res.status(400).json({ error: 'hours must be an array of 7 day entries' });
    }

    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      await conn.query('DELETE FROM business_hours WHERE client_id = $1', [req.clientId]);

      for (const h of hours) {
        await conn.query(
          `INSERT INTO business_hours (client_id, day_of_week, is_open, open_time, close_time, after_hours_mode)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.clientId, h.day_of_week, h.is_open, h.open_time || null, h.close_time || null, h.after_hours_mode || 'voicemail']
        );
      }

      await conn.query('COMMIT');
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    } finally {
      conn.release();
    }

    await promptCompiler.compile(req.clientId);

    res.json({ status: 'updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/dashboard/scheduling
 * Upsert scheduling_config. Invalidates cache.
 *
 * Body: { buffer_minutes, max_daily_bookings, advance_days, slot_duration_min }
 */
router.put('/scheduling', async (req, res, next) => {
  try {
    const { buffer_minutes, max_daily_bookings, advance_days, slot_duration_min } = req.body;

    await pool.query(
      `INSERT INTO scheduling_config (client_id, buffer_minutes, max_daily_bookings, advance_days, slot_duration_min)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id) DO UPDATE SET
         buffer_minutes = COALESCE($2, scheduling_config.buffer_minutes),
         max_daily_bookings = COALESCE($3, scheduling_config.max_daily_bookings),
         advance_days = COALESCE($4, scheduling_config.advance_days),
         slot_duration_min = COALESCE($5, scheduling_config.slot_duration_min),
         updated_at = NOW()`,
      [req.clientId, buffer_minutes, max_daily_bookings, advance_days, slot_duration_min]
    );

    await invalidateCache(req.clientId);

    res.json({ status: 'updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/dashboard/agent
 * Update agent persona fields. Recompiles system prompt and invalidates cache.
 *
 * Body: { agent_name, agent_voice, greeting_script, tone_tags, phrases_use, phrases_avoid }
 */
router.put('/agent', async (req, res, next) => {
  try {
    const { agent_name, agent_voice, greeting_script, tone_tags, phrases_use, phrases_avoid } = req.body;

    await pool.query(
      `UPDATE clients SET
         agent_name = COALESCE($2, agent_name),
         agent_voice = COALESCE($3, agent_voice),
         greeting_script = COALESCE($4, greeting_script),
         tone_tags = COALESCE($5, tone_tags),
         phrases_use = COALESCE($6, phrases_use),
         phrases_avoid = COALESCE($7, phrases_avoid),
         updated_at = NOW()
       WHERE id = $1`,
      [req.clientId, agent_name, agent_voice, greeting_script,
       tone_tags ? JSON.stringify(tone_tags) : null,
       phrases_use ? JSON.stringify(phrases_use) : null,
       phrases_avoid ? JSON.stringify(phrases_avoid) : null]
    );

    await promptCompiler.compile(req.clientId);

    res.json({ status: 'updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/dashboard/calls
 * Paginated call_logs with optional filters.
 *
 * Query: ?limit=20&offset=0&start_date=&end_date=&intent=&outcome=
 */
router.get('/calls', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const { start_date, end_date, intent, outcome } = req.query;

    const conditions = ['client_id = $1'];
    const params = [req.clientId];
    let idx = 2;

    if (start_date) {
      conditions.push(`created_at >= $${idx}`);
      params.push(start_date);
      idx++;
    }
    if (end_date) {
      conditions.push(`created_at <= $${idx}`);
      params.push(end_date);
      idx++;
    }
    if (intent) {
      conditions.push(`intent = $${idx}`);
      params.push(intent);
      idx++;
    }
    if (outcome) {
      conditions.push(`outcome = $${idx}`);
      params.push(outcome);
      idx++;
    }

    const where = conditions.join(' AND ');

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM call_logs WHERE ${where}`, params),
      pool.query(
        `SELECT * FROM call_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    res.json({
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
      calls: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/dashboard/wallet
 * Wallet balance + recent transactions.
 */
router.get('/wallet', async (req, res, next) => {
  try {
    const wallet = await getWalletInfo(req.clientId);
    if (!wallet) return res.status(404).json({ error: 'No wallet found' });
    res.json(wallet);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
