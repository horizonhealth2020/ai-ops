'use strict';

const pool = require('../config/database');
const stripeIntegration = require('../integrations/stripe');
const squareIntegration = require('../integrations/square');
const { sendPaymentLink } = require('../integrations/twilio');
const logger = require('../utils/logger');

/**
 * Determine which payment processor a client uses.
 */
async function getPaymentProcessor(clientId) {
  const result = await pool.query(
    `SELECT platform FROM client_integrations
     WHERE client_id = $1 AND integration_type = 'payment' AND is_active = true
     LIMIT 1`,
    [clientId]
  );

  if (result.rows.length > 0) return result.rows[0].platform;

  // Default to stripe if platform key exists
  return 'stripe';
}

/**
 * Create a payment intent and optionally send SMS link.
 *
 * @param {string} clientId
 * @param {object} params - { amount_cents, description, caller_phone, booking_id }
 * @returns {object} payment result
 */
async function createPayment(clientId, params) {
  const processor = await getPaymentProcessor(clientId);

  let paymentResult;
  if (processor === 'square') {
    paymentResult = await squareIntegration.createPaymentIntent(clientId, params);
  } else {
    paymentResult = await stripeIntegration.createPaymentIntent(clientId, params);
  }

  // Send payment link via SMS if we have a phone number and a link
  if (params.caller_phone && paymentResult.payment_link) {
    try {
      await sendPaymentLink(params.caller_phone, paymentResult.payment_link, params.description);
    } catch (err) {
      logger.warn('Failed to send payment SMS', { error: err.message });
    }
  }

  return {
    payment_id: paymentResult.payment_id,
    payment_link: paymentResult.payment_link,
    processor,
  };
}

module.exports = { createPayment };
