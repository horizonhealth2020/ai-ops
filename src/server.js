'use strict';

require('dotenv').config();

const config = require('./config');

// Validate required env vars before loading anything else
try {
  config.validate();
} catch (err) {
  console.error('Configuration error:', err.message);
  process.exit(1);
}

const app = require('./app');

const server = app.listen(config.port, () => {
  console.log(`[aiops-backend] Server started`);
  console.log(`  Port:     ${config.port}`);
  console.log(`  Env:      ${config.nodeEnv}`);
  console.log(`  Provider: ${config.llm.provider} (${config.llm.model})`);
  console.log(`  Base URL: ${config.llm.baseUrl || 'default'}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
