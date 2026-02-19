'use strict';

const callLogsDb = require('../db/queries/callLogs');
const tenantResolver = require('./tenantResolver');

/**
 * Compute call duration in seconds from Vapi call object.
 */
function computeDuration(call) {
  if (!call.startedAt || !call.endedAt) return null;
  const start = new Date(call.startedAt).getTime();
  const end = new Date(call.endedAt).getTime();
  return Math.round((end - start) / 1000);
}

/**
 * Log a completed call to the call_logs table.
 * Called from the /vapi/webhook endpoint after end-of-call events.
 *
 * @param {object} vapiWebhookBody - full Vapi webhook POST body
 */
async function logFromWebhook(vapiWebhookBody) {
  const { message } = vapiWebhookBody;
  if (!message || message.type !== 'end-of-call-report') return;

  const { call, artifact, endedReason } = message;

  const toNumber = tenantResolver.extractToNumber({ call });
  const client = toNumber ? await tenantResolver.resolveByPhone(toNumber) : null;
  if (!client) return;

  const summary = artifact?.analysis?.summary ||
    (artifact?.transcript ? artifact.transcript.slice(0, 500) : null);

  await callLogsDb.insert({
    client_id: client.id,
    call_id: call.id,
    caller_number: call.customer?.number || null,
    outcome: endedReason || 'unknown',
    summary,
    duration_seconds: computeDuration(call),
  });
}

module.exports = { logFromWebhook };
