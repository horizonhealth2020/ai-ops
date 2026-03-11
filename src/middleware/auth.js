'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');

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

/**
 * Clerk JWT verification for dashboard routes.
 * Extracts client_id from Clerk user publicMetadata and attaches as req.clientId.
 */
async function clerkAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  try {
    const { verifyToken } = require('@clerk/express');
    const payload = await verifyToken(token, {
      secretKey: env.clerkSecretKey,
    });

    const clientId = payload.public_metadata?.client_id;
    if (!clientId) {
      return res.status(403).json({ error: 'No client_id in user metadata' });
    }

    req.clientId = clientId;
    req.clerkUserId = payload.sub;
    next();
  } catch (err) {
    logger.warn('Clerk auth failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { vapiAuth, clerkAuth };
