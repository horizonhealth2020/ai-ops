'use strict';

const env = require('../config/env');

/**
 * Validates the Vapi API key sent as a Bearer token or X-Vapi-Secret header.
 */
function vapiAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const secret = req.headers['x-vapi-secret'] || authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!secret || secret !== env.vapiApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = { vapiAuth };
