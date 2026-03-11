'use strict';

const { checkBusinessHours, formatCurrentDateTime } = require('../utils/timeUtils');

/**
 * Build the full system prompt for a call.
 * Uses the pre-compiled system_prompt from the client record,
 * then appends caller context and current time.
 *
 * @param {object} client - full client config from tenantResolver
 * @param {object} options
 * @param {Array} options.faqResults - relevant FAQ entries from pgvector search
 * @param {object} options.callerContext - returning caller info from callerMemory
 * @returns {string} assembled system prompt
 */
function buildPrompt(client, { faqResults = [], callerContext = null } = {}) {
  const parts = [];

  // Base pre-compiled prompt
  if (client.system_prompt) {
    parts.push(client.system_prompt);
  }

  // Current date/time and business hours status
  const timezone = client.timezone || 'America/New_York';
  const dateTime = formatCurrentDateTime(timezone);
  const businessHours = client.business_hours || [];
  const { isOpen, currentDay } = checkBusinessHours(businessHours, timezone);

  parts.push(`\nCurrent date and time: ${dateTime}`);
  parts.push(`Business hours status: ${isOpen ? 'OPEN' : 'CLOSED'} (${currentDay})`);

  // Relevant FAQs from pgvector search
  if (faqResults.length > 0) {
    parts.push('\nRelevant FAQ information:');
    for (const faq of faqResults) {
      parts.push(`Q: ${faq.question}\nA: ${faq.answer}`);
    }
  }

  // Returning caller context
  if (callerContext) {
    parts.push('\nReturning caller information:');
    if (callerContext.caller_name) {
      parts.push(`- Caller name: ${callerContext.caller_name}`);
    }
    if (callerContext.previous_calls > 0) {
      parts.push(`- Previous calls: ${callerContext.previous_calls}`);
    }
    if (callerContext.last_intent) {
      parts.push(`- Last call intent: ${callerContext.last_intent}`);
    }
    if (callerContext.last_outcome) {
      parts.push(`- Last call outcome: ${callerContext.last_outcome}`);
    }
  }

  return parts.join('\n');
}

module.exports = { buildPrompt };
