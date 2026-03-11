'use strict';

const pool = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const CACHE_TTL = 300; // 5 minutes

/**
 * Load full client config from PostgreSQL.
 */
async function loadClientFromDb(clientId) {
  const result = await pool.query(
    `SELECT c.*,
       (SELECT json_agg(json_build_object(
         'day_of_week', bh.day_of_week, 'is_open', bh.is_open,
         'open_time', bh.open_time::text, 'close_time', bh.close_time::text,
         'after_hours_mode', bh.after_hours_mode
       )) FROM business_hours bh WHERE bh.client_id = c.id) AS business_hours,
       (SELECT row_to_json(sc) FROM scheduling_config sc WHERE sc.client_id = c.id) AS scheduling_config,
       (SELECT json_agg(json_build_object(
         'id', at.id, 'name', at.name, 'duration_min', at.duration_min,
         'fsm_job_type_id', at.fsm_job_type_id, 'is_active', at.is_active
       )) FROM appointment_types at WHERE at.client_id = c.id AND at.is_active = true) AS appointment_types
     FROM clients c
     WHERE c.id = $1 AND c.status = 'active'`,
    [clientId]
  );

  return result.rows[0] || null;
}

/**
 * Get client config with Redis caching.
 */
async function getClientConfig(clientId) {
  const cacheKey = `client_config:${clientId}`;

  // Try Redis cache first
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}

  // Fallback to PostgreSQL
  const client = await loadClientFromDb(clientId);
  if (!client) return null;

  // Cache in Redis
  try {
    await redis.set(cacheKey, JSON.stringify(client), 'EX', CACHE_TTL);
  } catch {}

  return client;
}

/**
 * Resolve client by business phone number.
 */
async function getClientByPhone(businessPhone) {
  const result = await pool.query(
    `SELECT id FROM clients WHERE business_phone = $1 AND status = 'active'`,
    [businessPhone]
  );
  if (result.rows.length === 0) return null;
  return getClientConfig(result.rows[0].id);
}

/**
 * Invalidate client config cache.
 */
async function invalidateCache(clientId) {
  try {
    await redis.del(`client_config:${clientId}`);
  } catch (err) {
    logger.warn('Failed to invalidate client cache', { client_id: clientId, error: err.message });
  }
}

module.exports = { getClientConfig, getClientByPhone, invalidateCache, loadClientFromDb };
