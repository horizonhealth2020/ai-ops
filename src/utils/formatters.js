'use strict';

/**
 * Normalize a raw phone number string to E.164 format (+1XXXXXXXXXX for US).
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.startsWith('+')) return raw;

  return `+${digits}`;
}

/**
 * Format cents to display price string.
 * @param {number} cents - amount in cents
 * @returns {string} e.g. "$89.00"
 */
function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

module.exports = { normalizePhone, formatPrice };
