'use strict';

const pool = require('../pool');

async function insertMany(clientId, services) {
  if (!services || services.length === 0) return;

  const values = services.flatMap((s, i) => {
    const base = i * 5;
    return [clientId, s.service_name, s.base_price || null, s.duration_minutes || 60, s.requires_deposit || false];
  });

  const placeholders = services.map((_, i) => {
    const base = i * 5;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  }).join(', ');

  await pool.query(
    `INSERT INTO services (client_id, service_name, base_price, duration_minutes, requires_deposit)
     VALUES ${placeholders}`,
    values
  );
}

async function findByClientAndName(clientId, serviceName) {
  const result = await pool.query(
    `SELECT * FROM services WHERE client_id = $1 AND LOWER(service_name) LIKE LOWER($2) LIMIT 1`,
    [clientId, `%${serviceName}%`]
  );
  return result.rows[0] || null;
}

module.exports = { insertMany, findByClientAndName };
