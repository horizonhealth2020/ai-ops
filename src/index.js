'use strict';

require('dotenv').config();

const env = require('./config/env');

try {
  env.validate();
} catch (err) {
  console.error('Configuration error:', err.message);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const redis = require('./config/redis');
const pool = require('./config/database');
const logger = require('./utils/logger');

const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

// Routes
app.use('/health', require('./routes/health'));
app.use('/api/v1/context', require('./routes/vapi'));
app.use('/api/v1/availability', require('./routes/availability'));
app.use('/api/v1/booking', require('./routes/booking'));
app.use('/api/v1/call', require('./routes/call'));
app.use('/api/v1/payment', require('./routes/payment'));
app.use('/api/v1/dashboard', require('./routes/dashboard'));
app.use('/api/v1/onboard', require('./routes/onboard'));

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// Global error handler
app.use(require('./middleware/errorHandler'));

// Start server
async function start() {
  try {
    await redis.connect();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis connection failed — continuing without cache', { error: err.message });
  }

  // Verify PG connection
  try {
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error('PostgreSQL connection failed', { error: err.message });
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    logger.info('Server started', { port: env.port, env: env.nodeEnv });
  });

  const shutdown = () => {
    logger.info('Shutting down gracefully');
    server.close(async () => {
      await redis.quit().catch(() => {});
      await pool.end().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();
