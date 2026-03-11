'use strict';

const router = require('express').Router();
const pool = require('../config/database');
const redis = require('../config/redis');

router.get('/', async (req, res) => {
  const checks = { postgres: 'down', redis: 'down' };

  try {
    await pool.query('SELECT 1');
    checks.postgres = 'up';
  } catch {}

  try {
    await redis.ping();
    checks.redis = 'up';
  } catch {}

  const healthy = checks.postgres === 'up' && checks.redis === 'up';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
