'use strict';

const HUMAN_REQUEST_PHRASES = [
  'talk to a human',
  'speak to a human',
  'speak to a person',
  'talk to a person',
  'talk to a real person',
  'speak with an agent',
  'talk to an agent',
  'speak to a representative',
  'talk to someone',
  'get a human',
  'real person',
  'live agent',
  'operator',
  'supervisor',
];

/**
 * Get the last user message text from an array of messages.
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
 * Check if the current time falls within business hours for a given timezone.
 * businessHours format: { monday: { open: "08:00", close: "17:00" }, ... }
 */
function isWithinBusinessHours(businessHours, timezone) {
  if (!businessHours || Object.keys(businessHours).length === 0) return true; // no hours = always open

  try {
    const now = new Date();
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'America/New_York',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = tzFormatter.formatToParts(now);
    const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase();
    let hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

    // Intl sometimes returns 24 for midnight
    if (hour === 24) hour = 0;

    const hours = businessHours[dayName];
    if (!hours) return false; // closed on this day

    const [openH, openM] = hours.open.split(':').map(Number);
    const [closeH, closeM] = hours.close.split(':').map(Number);

    const currentMinutes = hour * 60 + minute;
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  } catch {
    return true; // if timezone calc fails, default to open
  }
}

/**
 * Evaluate the call flow before invoking the LLM.
 * Returns an action decision for the controller.
 *
 * @param {Array} messages - conversation messages from Vapi
 * @param {object} client - resolved tenant record
 * @returns {{ action: 'proceed'|'emergency_transfer'|'after_hours'|'escalate', ... }}
 */
function evaluate(messages, client) {
  const cfg = client.call_config || {};
  const lastMessage = getLastUserMessage(messages);
  const lowerMessage = lastMessage.toLowerCase();

  // 1. Emergency keyword detection
  const keywords = Array.isArray(cfg.emergency_keywords) ? cfg.emergency_keywords : [];
  if (keywords.length > 0) {
    const triggered = keywords.find(kw => lowerMessage.includes(kw.toLowerCase()));
    if (triggered) {
      return {
        action: 'emergency_transfer',
        keyword: triggered,
        message: lastMessage,
      };
    }
  }

  // 2. After-hours check
  const isOpen = isWithinBusinessHours(cfg.business_hours, client.timezone);
  if (!isOpen) {
    return {
      action: 'after_hours',
      behavior: cfg.after_hours_behavior || 'voicemail',
      transfer_number: cfg.transfer_number,
    };
  }

  // 3. Human escalation request
  const requestedHuman = HUMAN_REQUEST_PHRASES.some(phrase => lowerMessage.includes(phrase));
  if (requestedHuman) {
    return {
      action: 'escalate',
      reason: 'caller_requested_human',
    };
  }

  return { action: 'proceed' };
}

module.exports = { evaluate, isWithinBusinessHours };
