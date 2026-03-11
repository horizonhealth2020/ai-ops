'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { encrypt } = require('../services/encryption');
const promptCompiler = require('../services/promptCompiler');
const logger = require('../utils/logger');

/**
 * POST /api/v1/onboard
 * Create a full client record from an intake form (webhook from external form/n8n).
 * No auth — called by trusted internal systems.
 *
 * Body: {
 *   business_name, business_phone, vertical, timezone,
 *   business_description, service_area,
 *   agent_name, agent_voice, greeting_script, tone_tags,
 *   phrases_use, phrases_avoid,
 *   transfer_phone, angry_handling, after_hours_behavior,
 *   warranties, promotions, differentiators,
 *   calls_to_reject, additional_rules,
 *   hours: [{ day_of_week, is_open, open_time, close_time, after_hours_mode }],
 *   scheduling: { buffer_minutes, max_daily_bookings, advance_days, slot_duration_min },
 *   services: [{ name, duration_min, fsm_job_type_id }],
 *   integration: { platform, integration_type, credentials, config },
 *   wallet_tier: "standard" | "growth" | "scale" | "enterprise"
 * }
 */
router.post('/', async (req, res, next) => {
  const conn = await pool.connect();

  try {
    const {
      business_name, business_phone, vertical, timezone,
      business_description, service_area,
      agent_name, agent_voice, greeting_script, tone_tags,
      phrases_use, phrases_avoid,
      transfer_phone, angry_handling, after_hours_behavior,
      warranties, promotions, differentiators,
      calls_to_reject, additional_rules,
      hours, scheduling, services, integration, wallet_tier,
    } = req.body;

    if (!business_name || !business_phone) {
      return res.status(400).json({ error: 'business_name and business_phone are required' });
    }

    await conn.query('BEGIN');

    const clientId = uuidv4();

    // 1. Insert client
    await conn.query(
      `INSERT INTO clients (
        id, business_name, business_phone, vertical, timezone, status,
        business_description, service_area,
        agent_name, agent_voice, greeting_script, tone_tags,
        phrases_use, phrases_avoid,
        transfer_phone, angry_handling, after_hours_behavior,
        warranties, promotions, differentiators,
        calls_to_reject, additional_rules
      ) VALUES (
        $1, $2, $3, $4, $5, 'active',
        $6, $7,
        $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18, $19,
        $20, $21
      )`,
      [
        clientId, business_name, business_phone,
        vertical || 'general', timezone || 'America/New_York',
        business_description || null, service_area || null,
        agent_name || null, agent_voice || null, greeting_script || null,
        tone_tags ? JSON.stringify(tone_tags) : null,
        phrases_use ? JSON.stringify(phrases_use) : null,
        phrases_avoid ? JSON.stringify(phrases_avoid) : null,
        transfer_phone || null, angry_handling || null, after_hours_behavior || null,
        warranties || null, promotions || null, differentiators || null,
        calls_to_reject || null, additional_rules || null,
      ]
    );

    // 2. Insert 7 business_hours rows
    const defaultHours = hours || Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      is_open: i >= 1 && i <= 5,
      open_time: '09:00',
      close_time: '17:00',
      after_hours_mode: 'voicemail',
    }));

    for (const h of defaultHours) {
      await conn.query(
        `INSERT INTO business_hours (client_id, day_of_week, is_open, open_time, close_time, after_hours_mode)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [clientId, h.day_of_week, h.is_open, h.open_time || null, h.close_time || null, h.after_hours_mode || 'voicemail']
      );
    }

    // 3. Insert scheduling_config
    const sched = scheduling || {};
    await conn.query(
      `INSERT INTO scheduling_config (client_id, buffer_minutes, max_daily_bookings, advance_days, slot_duration_min)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        clientId,
        sched.buffer_minutes || 15,
        sched.max_daily_bookings || 20,
        sched.advance_days || 14,
        sched.slot_duration_min || 60,
      ]
    );

    // 4. Insert appointment_types
    if (Array.isArray(services) && services.length > 0) {
      for (const svc of services) {
        await conn.query(
          `INSERT INTO appointment_types (client_id, name, duration_min, fsm_job_type_id)
           VALUES ($1, $2, $3, $4)`,
          [clientId, svc.name, svc.duration_min || 60, svc.fsm_job_type_id || null]
        );
      }
    }

    // 5. Insert integration credentials (encrypted)
    if (integration && integration.credentials) {
      const encrypted = encrypt(integration.credentials);
      await conn.query(
        `INSERT INTO client_integrations (client_id, platform, integration_type, credentials_encrypted, config, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          clientId,
          integration.platform,
          integration.integration_type || 'fsm',
          encrypted,
          integration.config ? JSON.stringify(integration.config) : null,
        ]
      );
    }

    // 6. Insert wallet
    await conn.query(
      `INSERT INTO wallets (client_id, balance_cents, tier)
       VALUES ($1, 0, $2)`,
      [clientId, wallet_tier || 'standard']
    );

    await conn.query('COMMIT');

    // 7. Compile system prompt (outside transaction — reads committed data)
    await promptCompiler.compile(clientId);

    logger.info('Client onboarded', { client_id: clientId, business_name, business_phone });

    res.status(201).json({
      client_id: clientId,
      business_phone,
      status: 'active',
    });
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
