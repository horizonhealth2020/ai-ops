'use strict';

const { decrypt } = require('../services/encryption');
const pool = require('../config/database');
const https = require('https');

const SQUARE_API = 'https://connect.squareup.com/v2';

/**
 * Make a Square API request.
 */
async function squareRequest(accessToken, method, path, body = null) {
  const url = new URL(`${SQUARE_API}${path}`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Create a Square payment link for a client.
 */
async function createPaymentIntent(clientId, params) {
  const result = await pool.query(
    `SELECT credentials_encrypted, config
     FROM client_integrations
     WHERE client_id = $1 AND platform = 'square' AND is_active = true
     LIMIT 1`,
    [clientId]
  );

  if (result.rows.length === 0) {
    throw new Error('No Square credentials configured for this client');
  }

  const creds = decrypt(result.rows[0].credentials_encrypted);
  const config = result.rows[0].config || {};

  const { v4: uuidv4 } = require('uuid');
  const resp = await squareRequest(creds.access_token, 'POST', '/online-checkout/payment-links', {
    idempotency_key: uuidv4(),
    quick_pay: {
      name: params.description,
      price_money: {
        amount: params.amount_cents,
        currency: (params.currency || 'usd').toUpperCase(),
      },
      location_id: config.location_id || creds.location_id,
    },
  });

  if (resp.status !== 200) {
    throw new Error(`Square API error: ${resp.status}`);
  }

  const link = resp.data.payment_link;

  // Record payment
  await pool.query(
    `INSERT INTO payments (client_id, booking_id, processor, external_payment_id, amount_cents, currency, status, payment_link)
     VALUES ($1, $2, 'square', $3, $4, $5, 'pending', $6)`,
    [clientId, params.booking_id || null, link.id, params.amount_cents,
     params.currency || 'usd', link.url]
  );

  return {
    payment_id: link.id,
    payment_link: link.url,
  };
}

module.exports = { createPaymentIntent };
