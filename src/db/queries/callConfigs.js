'use strict';

const pool = require('../pool');

async function upsert(clientId, config) {
  const {
    business_hours,
    after_hours_behavior,
    transfer_number,
    emergency_keywords,
    tone_override,
    faq_content,
  } = config;

  await pool.query(
    `INSERT INTO call_configs
       (client_id, business_hours, after_hours_behavior, transfer_number, emergency_keywords, tone_override, faq_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_id) DO UPDATE SET
       business_hours       = EXCLUDED.business_hours,
       after_hours_behavior = EXCLUDED.after_hours_behavior,
       transfer_number      = EXCLUDED.transfer_number,
       emergency_keywords   = EXCLUDED.emergency_keywords,
       tone_override        = EXCLUDED.tone_override,
       faq_content          = EXCLUDED.faq_content`,
    [
      clientId,
      JSON.stringify(business_hours || {}),
      after_hours_behavior || 'voicemail',
      transfer_number || null,
      emergency_keywords || [],
      tone_override || null,
      JSON.stringify(faq_content || {}),
    ]
  );
}

module.exports = { upsert };
