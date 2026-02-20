#!/usr/bin/env node
'use strict';

/**
 * One-shot migration script.
 * Runs schema.sql then seed.sql against the Railway Postgres instance via TCP proxy.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/migrate.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const SCHEMA = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
const SEED   = fs.readFileSync(path.join(__dirname, '../seed.sql'),   'utf8');

async function run() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: false,
  });

  await client.connect();
  console.log('Connected to Postgres');

  console.log('Running schema.sql...');
  await client.query(SCHEMA);
  console.log('Schema applied.');

  console.log('Running seed.sql...');
  await client.query(SEED);
  console.log('Seed data inserted.');

  await client.end();
  console.log('Done.');
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
