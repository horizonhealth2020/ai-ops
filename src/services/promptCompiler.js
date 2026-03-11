'use strict';

const pool = require('../config/database');
const { invalidateCache } = require('../middleware/tenantResolver');
const logger = require('../utils/logger');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Compile and store the system prompt for a client.
 * Reads all config from DB, assembles the prompt, writes it back, and busts cache.
 *
 * @param {string} clientId
 * @returns {string} the compiled prompt
 */
async function compile(clientId) {
  // Load client + related config
  const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (clientResult.rows.length === 0) throw new Error(`Client ${clientId} not found`);
  const client = clientResult.rows[0];

  const hoursResult = await pool.query(
    'SELECT * FROM business_hours WHERE client_id = $1 ORDER BY day_of_week',
    [clientId]
  );

  const servicesResult = await pool.query(
    'SELECT * FROM appointment_types WHERE client_id = $1 AND is_active = true ORDER BY name',
    [clientId]
  );

  const prompt = assemblePrompt(client, hoursResult.rows, servicesResult.rows);

  // Store compiled prompt
  await pool.query(
    'UPDATE clients SET system_prompt = $1, updated_at = NOW() WHERE id = $2',
    [prompt, clientId]
  );

  // Bust Redis cache
  await invalidateCache(clientId);

  logger.info('System prompt compiled', { client_id: clientId, length: prompt.length });
  return prompt;
}

/**
 * Assemble the full system prompt from config pieces.
 */
function assemblePrompt(client, hours, services) {
  const parts = [];

  // Industry base
  if (client.vertical) {
    parts.push(`You are an AI phone receptionist for a ${client.vertical} business.`);
  }

  // Company info
  parts.push(`\nCompany: ${client.business_name}`);
  if (client.business_description) parts.push(`Description: ${client.business_description}`);
  if (client.service_area) parts.push(`Service area: ${client.service_area}`);
  if (client.business_phone) parts.push(`Business phone: ${client.business_phone}`);

  // Agent persona
  if (client.agent_name || client.agent_voice || client.tone_tags) {
    parts.push('\n## Agent Persona');
    if (client.agent_name) parts.push(`Your name is ${client.agent_name}.`);
    if (client.agent_voice) parts.push(`Voice: ${client.agent_voice}`);
    if (client.tone_tags) {
      const tags = Array.isArray(client.tone_tags) ? client.tone_tags : [client.tone_tags];
      parts.push(`Tone: ${tags.join(', ')}`);
    }
  }

  // Greeting
  if (client.greeting_script) {
    parts.push(`\n## Greeting\nAlways start calls with: "${client.greeting_script}"`);
  }

  // Business hours
  if (hours.length > 0) {
    parts.push('\n## Business Hours');
    for (const h of hours) {
      const dayName = DAY_NAMES[h.day_of_week] || `Day ${h.day_of_week}`;
      if (h.is_open) {
        parts.push(`${dayName}: ${h.open_time} - ${h.close_time}`);
      } else {
        parts.push(`${dayName}: Closed`);
      }
    }
  }

  // Services / appointment types
  if (services.length > 0) {
    parts.push('\n## Services');
    for (const svc of services) {
      parts.push(`- ${svc.name} (${svc.duration_min} minutes)`);
    }
  }

  // Warranties, promotions, differentiators
  if (client.warranties) parts.push(`\n## Warranties\n${client.warranties}`);
  if (client.promotions) parts.push(`\n## Current Promotions\n${client.promotions}`);
  if (client.differentiators) parts.push(`\n## Why Choose Us\n${client.differentiators}`);

  // Phrases
  if (client.phrases_use) {
    const phrases = Array.isArray(client.phrases_use) ? client.phrases_use : [client.phrases_use];
    parts.push(`\n## Always Use These Phrases\n${phrases.map(p => `- "${p}"`).join('\n')}`);
  }
  if (client.phrases_avoid) {
    const phrases = Array.isArray(client.phrases_avoid) ? client.phrases_avoid : [client.phrases_avoid];
    parts.push(`\n## Never Use These Phrases\n${phrases.map(p => `- "${p}"`).join('\n')}`);
  }

  // Escalation
  if (client.transfer_phone || client.angry_handling) {
    parts.push('\n## Escalation');
    if (client.transfer_phone) parts.push(`Transfer calls to: ${client.transfer_phone}`);
    if (client.angry_handling) parts.push(`Angry caller handling: ${client.angry_handling}`);
  }

  // Rejection rules
  if (client.calls_to_reject) parts.push(`\n## Calls to Reject\n${client.calls_to_reject}`);

  // Additional rules
  if (client.additional_rules) parts.push(`\n## Additional Rules\n${client.additional_rules}`);

  // After-hours behavior
  if (client.after_hours_behavior) parts.push(`\n## After Hours\n${client.after_hours_behavior}`);

  // Available tools
  parts.push('\n## Available Tools');
  parts.push('You have access to these tools during calls:');
  parts.push('- check_availability: Check available appointment slots');
  parts.push('- hold_slot: Temporarily hold a slot for the caller (5 min)');
  parts.push('- create_booking: Confirm and book an appointment');
  parts.push('- transfer_call: Transfer the call to a human');
  parts.push('- create_payment: Create a payment link and send via SMS');

  return parts.join('\n');
}

module.exports = { compile };
