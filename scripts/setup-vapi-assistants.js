#!/usr/bin/env node
'use strict';

/**
 * setup-vapi-assistants.js
 *
 * Creates or updates the three Vapi inbound assistants for the AI Ops backend:
 *   - Alex  (HVAC)
 *   - Sam   (Plumbing)
 *   - Lily  (Spa)
 *
 * Usage:
 *   node scripts/setup-vapi-assistants.js
 *
 * Required env vars:
 *   VAPI_API_KEY    — your Vapi API key
 *   BACKEND_URL     — deployed backend URL (e.g. https://aiops-backend.up.railway.app)
 *   VAPI_SECRET     — secret used to verify Vapi webhook calls
 *
 * Optional (if set, will UPDATE instead of CREATE):
 *   VAPI_HVAC_ASSISTANT_ID
 *   VAPI_PLUMBING_ASSISTANT_ID
 *   VAPI_SPA_ASSISTANT_ID
 */

require('dotenv').config();

const https = require('https');

const VAPI_API_KEY  = process.env.VAPI_API_KEY;
const BACKEND_URL   = (process.env.BACKEND_URL || '').replace(/\/$/, '');
const VAPI_SECRET   = process.env.VAPI_SECRET;

// ─── Validation ──────────────────────────────────────────────────────────────

if (!VAPI_API_KEY) {
  console.error('❌  Missing VAPI_API_KEY in environment.');
  process.exit(1);
}

if (!BACKEND_URL) {
  console.error('❌  Missing BACKEND_URL in environment. Example: https://your-app.up.railway.app');
  process.exit(1);
}

if (!VAPI_SECRET) {
  console.error('❌  Missing VAPI_SECRET in environment.');
  process.exit(1);
}

// ─── Assistant configs ────────────────────────────────────────────────────────

const opts = { backendUrl: BACKEND_URL, vapiSecret: VAPI_SECRET };

const ASSISTANTS = [
  {
    key: 'hvac',
    envIdVar: 'VAPI_HVAC_ASSISTANT_ID',
    existingId: process.env.VAPI_HVAC_ASSISTANT_ID,
    config: require('../src/vapi/assistants/hvac')(opts),
  },
  {
    key: 'plumbing',
    envIdVar: 'VAPI_PLUMBING_ASSISTANT_ID',
    existingId: process.env.VAPI_PLUMBING_ASSISTANT_ID,
    config: require('../src/vapi/assistants/plumbing')(opts),
  },
  {
    key: 'spa',
    envIdVar: 'VAPI_SPA_ASSISTANT_ID',
    existingId: process.env.VAPI_SPA_ASSISTANT_ID,
    config: require('../src/vapi/assistants/spa')(opts),
  },
];

// ─── Vapi API helper ──────────────────────────────────────────────────────────

function vapiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: 'api.vapi.ai',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Vapi API ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Failed to parse Vapi response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createAssistant(config) {
  return vapiRequest('POST', '/assistant', config);
}

async function updateAssistant(id, config) {
  return vapiRequest('PATCH', `/assistant/${id}`, config);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀  Setting up Vapi assistants for AI Ops Backend');
  console.log(`    Backend URL : ${BACKEND_URL}`);
  console.log(`    Webhook URL : ${BACKEND_URL}/vapi/webhook\n`);

  const results = [];

  for (const assistant of ASSISTANTS) {
    const { key, envIdVar, existingId, config } = assistant;
    const label = config.name;

    try {
      let result;

      if (existingId) {
        console.log(`🔄  Updating ${label} (${existingId})...`);
        result = await updateAssistant(existingId, config);
        console.log(`✅  Updated  ${label} — ID: ${result.id}`);
      } else {
        console.log(`➕  Creating ${label}...`);
        result = await createAssistant(config);
        console.log(`✅  Created  ${label} — ID: ${result.id}`);
      }

      results.push({ key, name: label, id: result.id, envVar: envIdVar });
    } catch (err) {
      console.error(`❌  Failed for ${label}: ${err.message}`);
      process.exit(1);
    }
  }

  // ─── Print env var block to copy into .env / Railway ─────────────────────
  console.log('\n─────────────────────────────────────────────────');
  console.log('  Copy these into your .env and Railway variables:');
  console.log('─────────────────────────────────────────────────');
  for (const r of results) {
    console.log(`${r.envVar}=${r.id}`);
  }
  console.log('─────────────────────────────────────────────────\n');

  console.log('✅  All assistants ready. Assign each assistant ID to the');
  console.log('    matching inbound phone number in your Vapi dashboard.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
