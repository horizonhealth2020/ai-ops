'use strict';

const tenantResolver = require('../services/tenantResolver');
const promptAssembler = require('../services/promptAssembler');
const callFlowGuard = require('../services/callFlowGuard');
const agentLoop = require('../services/agentLoop');
const callLogger = require('../services/callLogger');

/**
 * Format a text chunk as an OpenAI-compatible SSE data chunk.
 */
function formatSSEChunk(text, index = 0) {
  return JSON.stringify({
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: process.env.LLM_MODEL || 'unknown',
    choices: [
      {
        index,
        delta: { role: 'assistant', content: text },
        finish_reason: null,
      },
    ],
  });
}

function formatSSEDone() {
  return JSON.stringify({
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: process.env.LLM_MODEL || 'unknown',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });
}

/**
 * POST /vapi/chat
 * Main Vapi custom LLM endpoint. Handles tenant resolution, call flow gating,
 * and streams the LLM response back to Vapi in OpenAI SSE format.
 */
async function chat(req, res) {
  // Resolve tenant from inbound phone number
  const client = await tenantResolver.resolveFromRequest(req.body);

  if (!client) {
    return res.status(404).json({ error: 'No active client found for this phone number.' });
  }

  const messages = req.body.messages || [];

  // Pre-LLM call flow checks
  const flowDecision = callFlowGuard.evaluate(messages, client);

  // Set SSE headers before any streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const writeChunk = (text) => {
    res.write(`data: ${formatSSEChunk(text)}\n\n`);
  };

  const writeDone = (_transferData) => {
    res.write(`data: ${formatSSEDone()}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  };

  // Handle emergency transfer immediately — don't invoke LLM
  if (flowDecision.action === 'emergency_transfer') {
    writeChunk(
      `This sounds like an emergency. I'm connecting you with a technician immediately. Please stay on the line.`
    );
    writeDone({ action: 'transfer', priority: 'emergency', transfer_to: client.call_config.transfer_number });
    return;
  }

  // Handle after-hours
  if (flowDecision.action === 'after_hours') {
    const behavior = flowDecision.behavior;

    if (behavior === 'message_only') {
      writeChunk(
        `Thank you for calling ${client.company_name}. We're currently closed. Please leave a message or call back during our business hours.`
      );
    } else if (behavior === 'emergency_transfer') {
      writeChunk(
        `Thank you for calling ${client.company_name}. We're currently closed, but I can connect you with our on-call team for emergencies.`
      );
    } else {
      // voicemail
      writeChunk(
        `Thank you for calling ${client.company_name}. Our office is currently closed. Please leave a message and we'll return your call next business day.`
      );
    }
    writeDone();
    return;
  }

  // Handle immediate human escalation request
  if (flowDecision.action === 'escalate') {
    writeChunk(`Of course! Let me connect you with a member of our team right now.`);
    writeDone({ action: 'transfer', priority: 'normal', transfer_to: client.call_config.transfer_number });
    return;
  }

  // Assemble system prompt on first turn (no system message yet in history)
  const isFirstTurn = !messages.some(m => m.role === 'system');
  const systemPrompt = isFirstTurn ? promptAssembler.assemble(client) : null;

  // Run the agentic loop
  try {
    await agentLoop.run({
      client,
      messages,
      systemPrompt,
      onChunk: writeChunk,
      onDone: writeDone,
    });
  } catch (err) {
    console.error('Agent loop error:', err.message);
    if (!res.writableEnded) {
      writeChunk(`I'm sorry, I encountered an error. Please try again or call back shortly.`);
      writeDone();
    }
  }
}

/**
 * POST /vapi/webhook
 * Receives post-call events from Vapi (end-of-call report, etc.)
 */
async function webhook(req, res) {
  try {
    await callLogger.logFromWebhook(req.body);
  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
  res.status(200).json({ received: true });
}

module.exports = { chat, webhook };
