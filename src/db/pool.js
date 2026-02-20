'use strict';

const { Pool } = require('pg');
const config = require('../config');

// DB_SSL=false disables SSL (needed for Railway internal Postgres)
const sslConfig = process.env.DB_SSL === 'false'
  ? false
  : config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle pg client:', err.message);
});

module.exports = pool;
