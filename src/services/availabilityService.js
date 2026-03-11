'use strict';

const pool = require('../config/database');
const redis = require('../config/redis');
const { v4: uuidv4 } = require('uuid');

const HOLD_TTL = 300; // 5 minutes

/**
 * Check available slots for a client on a given date.
 * Reads from cached_availability and filters out Redis-held slots.
 *
 * @param {string} clientId - UUID
 * @param {string} date - YYYY-MM-DD
 * @returns {object} { slots: Array, cache_age_seconds: number }
 */
async function checkAvailability(clientId, date) {
  // Read from PostgreSQL
  const result = await pool.query(
    `SELECT id, date, start_time::text, end_time::text, status, technician_id, cache_updated_at
     FROM cached_availability
     WHERE client_id = $1 AND date = $2 AND status = 'open'
     ORDER BY start_time`,
    [clientId, date]
  );

  const slots = result.rows;
  if (slots.length === 0) {
    return { slots: [], cache_age_seconds: 0 };
  }

  // Check Redis for held slots
  const heldSlotsKey = `held_slots:${clientId}`;
  let heldSlots = [];
  try {
    heldSlots = await redis.smembers(heldSlotsKey);
  } catch {}

  // Filter out held slots
  const heldSet = new Set(heldSlots);
  const available = slots.filter(slot => {
    const slotKey = `${date}:${slot.start_time.substring(0, 5)}`;
    return !heldSet.has(slotKey);
  });

  const cacheAge = slots[0]?.cache_updated_at
    ? Math.floor((Date.now() - new Date(slots[0].cache_updated_at).getTime()) / 1000)
    : 0;

  return {
    slots: available.map(s => ({
      id: s.id,
      date: s.date,
      start_time: s.start_time.substring(0, 5),
      end_time: s.end_time.substring(0, 5),
      technician_id: s.technician_id,
    })),
    cache_age_seconds: cacheAge,
  };
}

/**
 * Soft-lock a slot using Redis SETNX.
 *
 * @param {string} clientId - UUID
 * @param {string} callId - Vapi call ID
 * @param {string} date - YYYY-MM-DD
 * @param {string} time - HH:MM
 * @returns {object} { status: 'held'|'unavailable', hold_id?: string, alternative_slots?: Array }
 */
async function holdSlot(clientId, callId, date, time) {
  const holdKey = `hold:${clientId}:${date}:${time}`;
  const holdId = uuidv4();

  // Atomic SETNX — only one caller can hold a slot
  const acquired = await redis.set(holdKey, JSON.stringify({ hold_id: holdId, call_id: callId }), 'EX', HOLD_TTL, 'NX');

  if (!acquired) {
    // Slot already held — return alternatives
    const alternatives = await checkAvailability(clientId, date);
    return {
      status: 'unavailable',
      message: 'This time slot is currently being held by another caller.',
      alternative_slots: alternatives.slots.slice(0, 3),
    };
  }

  // Add to held_slots set for filtering
  const heldSlotsKey = `held_slots:${clientId}`;
  const slotRef = `${date}:${time}`;
  await redis.sadd(heldSlotsKey, slotRef);
  await redis.expire(heldSlotsKey, HOLD_TTL);

  // Track which call holds this slot (for cleanup on call end)
  const callHoldsKey = `call_holds:${callId}`;
  await redis.set(callHoldsKey, JSON.stringify({ hold_key: holdKey, slot_ref: slotRef, client_id: clientId }), 'EX', HOLD_TTL);

  return {
    status: 'held',
    hold_id: holdId,
    hold_key: holdKey,
    expires_in_seconds: HOLD_TTL,
  };
}

/**
 * Release a hold.
 *
 * @param {string} clientId - UUID
 * @param {string} date - YYYY-MM-DD
 * @param {string} time - HH:MM
 */
async function releaseHold(clientId, date, time) {
  const holdKey = `hold:${clientId}:${date}:${time}`;
  const slotRef = `${date}:${time}`;
  const heldSlotsKey = `held_slots:${clientId}`;

  await redis.del(holdKey);
  await redis.srem(heldSlotsKey, slotRef);
}

/**
 * Release all holds for a given call (cleanup on call end).
 */
async function releaseCallHolds(callId) {
  const callHoldsKey = `call_holds:${callId}`;
  try {
    const data = await redis.get(callHoldsKey);
    if (!data) return;

    const { hold_key, slot_ref, client_id } = JSON.parse(data);
    await redis.del(hold_key);
    await redis.srem(`held_slots:${client_id}`, slot_ref);
    await redis.del(callHoldsKey);
  } catch {}
}

module.exports = { checkAvailability, holdSlot, releaseHold, releaseCallHolds };
