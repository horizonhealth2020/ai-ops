'use strict';

const pool = require('../db/pool');
const clientsDb = require('../db/queries/clients');
const servicesDb = require('../db/queries/services');
const callConfigsDb = require('../db/queries/callConfigs');
const callLogsDb = require('../db/queries/callLogs');
const promptAssembler = require('../services/promptAssembler');
const tenantResolver = require('../services/tenantResolver');

/**
 * POST /clients
 * Onboard a new client. Creates client, services, and call_config in a transaction.
 */
async function create(req, res, next) {
  const { company_name, phone_number, industry_vertical, crm_platform, crm_credentials, timezone, services, call_config } = req.body;

  if (!company_name || !phone_number || !industry_vertical) {
    return res.status(400).json({ error: 'company_name, phone_number, and industry_vertical are required.' });
  }

  const validVerticals = ['hvac', 'plumbing', 'spa'];
  if (!validVerticals.includes(industry_vertical)) {
    return res.status(400).json({ error: `industry_vertical must be one of: ${validVerticals.join(', ')}` });
  }

  const normalizedPhone = tenantResolver.normalizePhone(phone_number);

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const clientRow = await clientsDb.create({
      company_name,
      phone_number: normalizedPhone,
      industry_vertical,
      crm_platform: crm_platform || 'stub',
      crm_credentials: crm_credentials || {},
      timezone: timezone || 'America/New_York',
    });

    const clientId = clientRow.id;

    if (Array.isArray(services) && services.length > 0) {
      await servicesDb.insertMany(clientId, services);
    }

    if (call_config) {
      await callConfigsDb.upsert(clientId, call_config);
    }

    await pgClient.query('COMMIT');

    res.status(201).json({
      id: clientId,
      company_name,
      phone_number: normalizedPhone,
      industry_vertical,
    });
  } catch (err) {
    await pgClient.query('ROLLBACK');
    next(err);
  } finally {
    pgClient.release();
  }
}

/**
 * GET /clients/:id/config
 * Return the full assembled config (system prompt + raw config) for a client.
 */
async function getConfig(req, res, next) {
  try {
    const client = await clientsDb.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found.' });

    const assembledPrompt = promptAssembler.assemble(client);

    res.json({
      client: {
        id: client.id,
        company_name: client.company_name,
        phone_number: client.phone_number,
        industry_vertical: client.industry_vertical,
        crm_platform: client.crm_platform,
        timezone: client.timezone,
        active: client.active,
        services: client.services,
        call_config: client.call_config,
      },
      assembled_prompt: assembledPrompt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /clients/:id/calls
 * Return call history for a client with pagination.
 */
async function getCalls(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    const calls = await callLogsDb.findByClient(req.params.id, { limit, offset });

    res.json({ calls, limit, offset });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, getConfig, getCalls };
