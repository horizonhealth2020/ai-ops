'use strict';

const Stripe = require('stripe');
const { decrypt } = require('../services/encryption');
const pool = require('../config/database');

/**
 * Create a Stripe payment intent for a client.
 *
 * @param {string} clientId - UUID
 * @param {object} params - { amount_cents, currency, description, booking_id, metadata }
 * @returns {object} { payment_id, client_secret, payment_link }
 */
async function createPaymentIntent(clientId, params) {
  // Load client's Stripe credentials
  const result = await pool.query(
    `SELECT credentials_encrypted, config
     FROM client_integrations
     WHERE client_id = $1 AND platform = 'stripe' AND is_active = true
     LIMIT 1`,
    [clientId]
  );

  // Fall back to platform Stripe key if no client-specific integration
  let stripeKey;
  if (result.rows.length > 0) {
    const creds = decrypt(result.rows[0].credentials_encrypted);
    stripeKey = creds.secret_key;
  } else {
    stripeKey = process.env.STRIPE_SECRET_KEY;
  }

  if (!stripeKey) {
    throw new Error('No Stripe credentials configured');
  }

  const stripe = new Stripe(stripeKey);

  const intent = await stripe.paymentIntents.create({
    amount: params.amount_cents,
    currency: params.currency || 'usd',
    description: params.description,
    metadata: {
      client_id: clientId,
      booking_id: params.booking_id || '',
      ...params.metadata,
    },
  });

  // Record payment in DB
  await pool.query(
    `INSERT INTO payments (client_id, booking_id, processor, external_payment_id, amount_cents, currency, status, payment_link)
     VALUES ($1, $2, 'stripe', $3, $4, $5, 'pending', $6)`,
    [clientId, params.booking_id || null, intent.id, params.amount_cents,
     params.currency || 'usd', intent.url || null]
  );

  return {
    payment_id: intent.id,
    client_secret: intent.client_secret,
    payment_link: intent.url,
  };
}

module.exports = { createPaymentIntent };
