'use strict';

const pool = require('../pool');

async function findByPhone(normalizedPhone) {
  const result = await pool.query(
    `SELECT
       c.id, c.company_name, c.phone_number, c.industry_vertical,
       c.crm_platform, c.crm_credentials, c.timezone, c.active, c.created_at,
       cc.business_hours, cc.after_hours_behavior, cc.transfer_number,
       cc.emergency_keywords, cc.tone_override, cc.faq_content,
       COALESCE(
         json_agg(
           json_build_object(
             'service_name', s.service_name,
             'base_price', s.base_price,
             'duration_minutes', s.duration_minutes,
             'requires_deposit', s.requires_deposit
           )
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS services
     FROM clients c
     LEFT JOIN call_configs cc ON cc.client_id = c.id
     LEFT JOIN services s ON s.client_id = c.id
     WHERE c.phone_number = $1 AND c.active = true
     GROUP BY c.id, cc.id`,
    [normalizedPhone]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    company_name: row.company_name,
    phone_number: row.phone_number,
    industry_vertical: row.industry_vertical,
    crm_platform: row.crm_platform,
    crm_credentials: row.crm_credentials || {},
    timezone: row.timezone,
    active: row.active,
    created_at: row.created_at,
    services: row.services || [],
    call_config: {
      business_hours: row.business_hours,
      after_hours_behavior: row.after_hours_behavior,
      transfer_number: row.transfer_number,
      emergency_keywords: row.emergency_keywords || [],
      tone_override: row.tone_override,
      faq_content: row.faq_content || {},
    },
  };
}

async function findById(id) {
  const result = await pool.query(
    `SELECT
       c.id, c.company_name, c.phone_number, c.industry_vertical,
       c.crm_platform, c.crm_credentials, c.timezone, c.active, c.created_at,
       cc.business_hours, cc.after_hours_behavior, cc.transfer_number,
       cc.emergency_keywords, cc.tone_override, cc.faq_content,
       COALESCE(
         json_agg(
           json_build_object(
             'service_name', s.service_name,
             'base_price', s.base_price,
             'duration_minutes', s.duration_minutes,
             'requires_deposit', s.requires_deposit
           )
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS services
     FROM clients c
     LEFT JOIN call_configs cc ON cc.client_id = c.id
     LEFT JOIN services s ON s.client_id = c.id
     WHERE c.id = $1
     GROUP BY c.id, cc.id`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    company_name: row.company_name,
    phone_number: row.phone_number,
    industry_vertical: row.industry_vertical,
    crm_platform: row.crm_platform,
    crm_credentials: row.crm_credentials || {},
    timezone: row.timezone,
    active: row.active,
    created_at: row.created_at,
    services: row.services || [],
    call_config: {
      business_hours: row.business_hours,
      after_hours_behavior: row.after_hours_behavior,
      transfer_number: row.transfer_number,
      emergency_keywords: row.emergency_keywords || [],
      tone_override: row.tone_override,
      faq_content: row.faq_content || {},
    },
  };
}

async function create(data) {
  const { company_name, phone_number, industry_vertical, crm_platform, crm_credentials, timezone } = data;
  const result = await pool.query(
    `INSERT INTO clients (company_name, phone_number, industry_vertical, crm_platform, crm_credentials, timezone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      company_name,
      phone_number,
      industry_vertical,
      crm_platform || 'stub',
      JSON.stringify(crm_credentials || {}),
      timezone || 'America/New_York',
    ]
  );
  return result.rows[0];
}

module.exports = { findByPhone, findById, create };
