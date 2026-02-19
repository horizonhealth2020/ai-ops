'use strict';

const clientsDb = require('../db/queries/clients');

/**
 * Normalize a raw phone number string to E.164 format (+1XXXXXXXXXX for US).
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+')) return raw; // already E.164

  return `+${digits}`;
}

/**
 * Extract the "to" phone number from a Vapi request body.
 * Vapi sends the destination number in different locations depending on call type.
 */
function extractToNumber(body) {
  const call = body.call || {};

  // Vapi outbound: call.phoneNumbers[].destination.number
  if (Array.isArray(call.phoneNumbers) && call.phoneNumbers.length > 0) {
    return call.phoneNumbers[0]?.destination?.number || call.phoneNumbers[0]?.number;
  }

  // Vapi inbound: call.toNumber
  if (call.toNumber) return call.toNumber;

  // Fallback: check top-level
  return body.toNumber || null;
}

/**
 * Resolve the active client record from the inbound phone number.
 * @param {object} vapiBody - the full Vapi request body
 * @returns {object|null} client record with call_config and services, or null
 */
async function resolveFromRequest(vapiBody) {
  const rawNumber = extractToNumber(vapiBody);
  if (!rawNumber) return null;

  const normalized = normalizePhone(rawNumber);
  if (!normalized) return null;

  return clientsDb.findByPhone(normalized);
}

/**
 * Resolve client by a raw phone number string.
 */
async function resolveByPhone(rawNumber) {
  const normalized = normalizePhone(rawNumber);
  if (!normalized) return null;
  return clientsDb.findByPhone(normalized);
}

module.exports = { resolveFromRequest, resolveByPhone, normalizePhone, extractToNumber };
