'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required for seeding');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

async function run() {
  const seedsDir = path.join(__dirname, '..', 'seeds');
  const files = fs.readdirSync(seedsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} seed files...`);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(seedsDir, file), 'utf8');
    console.log(`  → ${file}`);
    try {
      await pool.query(sql);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('Seeding completed.');
  await pool.end();
}

run().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
