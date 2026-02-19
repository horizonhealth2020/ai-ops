'use strict';

const config = require('../config');

/**
 * Validates the VAPI_SECRET sent by Vapi as a Bearer token.
 * Applied to all /vapi/* routes.
 */
function vapiAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const secret = req.headers['x-vapi-secret'] || authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!secret || secret !== config.vapiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = vapiAuth;
