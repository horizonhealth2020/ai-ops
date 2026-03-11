'use strict';

const pool = require('../config/database');
const { decrypt } = require('./encryption');
const availabilityService = require('./availabilityService');
const logger = require('../utils/logger');
const env = require('../config/env');

// FSM adapter registry
const FSM_ADAPTERS = {
  housecall_pro: () => require('../integrations/housecallpro'),
  jobber: () => require('../integrations/jobber'),
  servicetitan: () => require('../integrations/servicetitan'),
};

/**
 * Load and decrypt FSM credentials for a client.
 */
async function getFsmCredentials(clientId) {
  const result = await pool.query(
    `SELECT platform, credentials_encrypted, config
     FROM client_integrations
     WHERE client_id = $1 AND integration_type = 'fsm' AND is_active = true
     LIMIT 1`,
    [clientId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  let credentials;
  try {
    credentials = decrypt(row.credentials_encrypted);
  } catch {
    credentials = {};
  }

  return {
    platform: row.platform,
    credentials,
    config: row.config || {},
  };
}

/**
 * Fire n8n webhook (fire-and-forget).
 */
function fireN8nWebhook(eventType, payload) {
  if (!env.n8nWebhookBaseUrl) return;

  const url = `${env.n8nWebhookBaseUrl}/${eventType}`;
  const https = require('https');
  const http = require('http');
  const lib = url.startsWith('https') ? https : http;

  try {
    const urlObj = new URL(url);
    const body = JSON.stringify(payload);
    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    req.on('error', (err) => {
      logger.warn('n8n webhook failed', { event: eventType, error: err.message });
    });
    req.write(body);
    req.end();
  } catch (err) {
    logger.warn('n8n webhook fire failed', { event: eventType, error: err.message });
  }
}

/**
 * Create a booking with two-phase FSM verification.
 *
 * @param {object} params
 * @returns {object} booking result
 */
async function createBooking(params) {
  const {
    client_id, call_id, caller_name, caller_phone, caller_email,
    caller_address, service_type, scheduled_date, scheduled_time,
    duration_min, notes,
  } = params;

  // 1. Load FSM credentials
  const fsm = await getFsmCredentials(client_id);

  // 2. Verify slot with FSM (if integration exists)
  if (fsm && FSM_ADAPTERS[fsm.platform]) {
    try {
      const adapter = FSM_ADAPTERS[fsm.platform]();
      const verification = await adapter.verifySlotAvailability(fsm.credentials, {
        date: scheduled_date,
        time: scheduled_time,
      });

      if (!verification.available) {
        // Slot taken — release hold, return alternatives
        await availabilityService.releaseHold(client_id, scheduled_date, scheduled_time);
        const alternatives = await availabilityService.checkAvailability(client_id, scheduled_date);

        return {
          status: 'slot_taken',
          fallback_msg: `I'm sorry, that time slot was just taken. Let me find you another option.`,
          alternative_slots: alternatives.slots.slice(0, 3),
        };
      }
    } catch (err) {
      logger.warn('FSM verification failed, proceeding with booking', {
        client_id, platform: fsm.platform, error: err.message,
      });
    }
  }

  // 3. Insert booking
  const result = await pool.query(
    `INSERT INTO bookings (
       client_id, call_id, caller_name, caller_phone, caller_email,
       caller_address, service_type, scheduled_date, scheduled_time,
       duration_min, notes, status, fsm_sync_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', 'pending')
     RETURNING id, status`,
    [client_id, call_id, caller_name, caller_phone, caller_email,
     caller_address, service_type, scheduled_date, scheduled_time,
     duration_min, notes]
  );

  const booking = result.rows[0];

  // 4. Update cached_availability
  await pool.query(
    `UPDATE cached_availability SET status = 'booked'
     WHERE client_id = $1 AND date = $2 AND start_time = $3::time`,
    [client_id, scheduled_date, scheduled_time]
  );

  // 5. Release Redis hold
  await availabilityService.releaseHold(client_id, scheduled_date, scheduled_time);

  // 6. Fire n8n webhook (fire-and-forget)
  fireN8nWebhook('booking-created', {
    booking_id: booking.id,
    client_id,
    call_id,
    caller_name,
    caller_phone,
    service_type,
    scheduled_date,
    scheduled_time,
  });

  return {
    status: 'confirmed',
    booking_id: booking.id,
    confirmation_msg: `Your ${service_type} appointment is confirmed for ${scheduled_date} at ${scheduled_time}. We look forward to seeing you!`,
  };
}

module.exports = { createBooking, fireN8nWebhook };
