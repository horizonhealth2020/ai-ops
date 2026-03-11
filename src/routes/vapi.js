'use strict';

const router = require('express').Router();
const OpenAI = require('openai');
const { vapiAuth } = require('../middleware/auth');
const { getClientConfig, getClientByPhone } = require('../middleware/tenantResolver');
const { buildPrompt } = require('../services/promptBuilder');
const { lookupCaller } = require('../services/callerMemory');
const { searchFaqs } = require('../services/faqSearch');
const env = require('../config/env');
const logger = require('../utils/logger');
const { normalizePhone } = require('../utils/formatters');
const pool = require('../config/database');

const openai = new OpenAI({ apiKey: env.openaiApiKey });

/**
 * Build tool definitions with client_id baked in.
 */
function buildToolDefs() {
  return [
    {
      type: 'function',
      function: {
        name: 'check_availability',
        description: 'Check available appointment slots for this business',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date to check in YYYY-MM-DD format' },
            service_type: { type: 'string', description: 'Type of service requested' },
          },
          required: ['date'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hold_slot',
        description: 'Temporarily hold an appointment slot for 5 minutes while collecting caller info',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            time: { type: 'string', description: 'Time in HH:MM format' },
            service_type: { type: 'string', description: 'Type of service' },
          },
          required: ['date', 'time'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_booking',
        description: 'Confirm and create an appointment booking',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            time: { type: 'string', description: 'Time in HH:MM format' },
            caller_name: { type: 'string', description: 'Full name of the caller' },
            caller_phone: { type: 'string', description: 'Phone number of the caller' },
            caller_email: { type: 'string', description: 'Email address (optional)' },
            caller_address: { type: 'string', description: 'Service address' },
            service_type: { type: 'string', description: 'Type of service requested' },
            notes: { type: 'string', description: 'Additional notes about the appointment' },
          },
          required: ['date', 'time', 'caller_name', 'caller_phone', 'service_type'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'transfer_call',
        description: 'Transfer the caller to a human team member',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Reason for transfer' },
          },
          required: ['reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_payment',
        description: 'Create a payment link and send it via SMS to the caller',
        parameters: {
          type: 'object',
          properties: {
            amount_cents: { type: 'integer', description: 'Amount in cents' },
            description: { type: 'string', description: 'Payment description' },
            caller_phone: { type: 'string', description: 'Phone to send payment link to' },
          },
          required: ['amount_cents', 'description', 'caller_phone'],
        },
      },
    },
  ];
}

/**
 * Extract the last user message text from messages array.
 */
function getLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;
      return typeof content === 'string' ? content : JSON.stringify(content);
    }
  }
  return '';
}

/**
 * Check if client wallet has sufficient balance.
 */
async function checkWalletBalance(clientId) {
  const result = await pool.query(
    'SELECT balance_cents FROM wallets WHERE client_id = $1',
    [clientId]
  );
  if (result.rows.length === 0) return true;
  return result.rows[0].balance_cents > 0;
}

/**
 * POST /api/v1/context/inject
 * Main Vapi custom LLM endpoint.
 */
router.post('/inject', vapiAuth, async (req, res) => {
  try {
    const body = req.body;
    const messages = body.messages || [];
    const call = body.call || {};
    const metadata = call.metadata || {};

    // 1. Resolve client
    const clientId = metadata.client_id;
    let client = null;

    if (clientId) {
      client = await getClientConfig(clientId);
    }

    // Fallback: resolve by phone number
    if (!client) {
      const toNumber = call.phoneNumber?.number || call.toNumber;
      if (toNumber) {
        const phone = normalizePhone(toNumber);
        client = await getClientByPhone(phone);
      }
    }

    if (!client) {
      return res.status(404).json({ error: 'No active client found for this call.' });
    }

    // 2. Check wallet balance
    let walletOk = true;
    try {
      walletOk = await checkWalletBalance(client.id);
    } catch {}

    // 3. Get caller phone for context lookup
    const callerPhone = call.customer?.number || null;

    // 4. Run FAQ search and caller lookup in parallel
    const lastUserMessage = getLastUserMessage(messages);
    const [faqResults, callerContext] = await Promise.all([
      searchFaqs(client.id, lastUserMessage),
      lookupCaller(client.id, callerPhone),
    ]);

    // 5. Build system prompt
    let systemPrompt = buildPrompt(client, { faqResults, callerContext });

    if (!walletOk) {
      systemPrompt += '\n\nIMPORTANT: The business voicemail system is currently active. Take a message from the caller including their name, phone number, and reason for calling. Do not book appointments or process payments.';
    }

    // 6. Build messages array with injected system prompt
    const llmMessages = [{ role: 'system', content: systemPrompt }];
    for (const msg of messages) {
      if (msg.role !== 'system') {
        llmMessages.push(msg);
      }
    }

    // 7. Build tool definitions
    const tools = walletOk ? buildToolDefs() : [];

    // 8. Proxy to OpenAI with streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const createParams = {
      model: env.openaiModel,
      messages: llmMessages,
      stream: true,
    };
    if (tools.length > 0) {
      createParams.tools = tools;
    }

    const stream = await openai.chat.completions.create(createParams);

    for await (const chunk of stream) {
      const data = JSON.stringify(chunk);
      res.write(`data: ${data}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

    logger.info('Context injection completed', {
      client_id: client.id,
      caller_phone: callerPhone,
      faqs_found: faqResults.length,
      returning_caller: !!callerContext,
    });

  } catch (err) {
    logger.error('Context injection error', { error: err.message });
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
});

module.exports = router;
