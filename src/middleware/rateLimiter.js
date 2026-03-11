'use strict';

const redis = require('../config/redis');

/**
 * Redis-based rate limiter middleware.
 * @param {number} maxRequests - max requests per window
 * @param {number} windowSeconds - window duration in seconds
 */
function rateLimiter(maxRequests = 60, windowSeconds = 60) {
  return async (req, res, next) => {
    const clientId = req.clientId || req.ip;
    const endpoint = req.route?.path || req.path;
    const key = `rate_limit:${clientId}:${endpoint}`;

    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }
      if (current > maxRequests) {
        return res.status(429).json({ error: 'Too many requests' });
      }
    } catch {
      // If Redis is down, allow the request
    }

    next();
  };
}

module.exports = rateLimiter;
