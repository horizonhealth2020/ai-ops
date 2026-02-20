'use strict';

/**
 * Vapi assistant configuration for the HVAC vertical.
 * Name: Alex — professional, knowledgeable, efficient.
 * Used for inbound scheduling, service inquiries, and emergency routing.
 */
module.exports = function hvacAssistant({ backendUrl, vapiSecret }) {
  return {
    name: 'Alex - HVAC Scheduling Assistant',

    model: {
      provider: 'custom-llm',
      url: `${backendUrl}/vapi/chat`,
      model: 'custom',
      // System prompt is assembled dynamically per-client on the backend.
      // Leave blank here — the backend injects it on the first turn.
      systemPrompt: '',
      temperature: 0.4,
    },

    voice: {
      provider: '11labs',
      voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam — clear, professional male
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: true,
    },

    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en-US',
      smartFormat: true,
    },

    firstMessage:
      "Thanks for calling! I'm Alex, your virtual scheduling assistant. Are you calling about a repair, maintenance, or a new installation — or is this an emergency?",

    firstMessageMode: 'assistant-speaks-first',

    endCallMessage: 'Thanks for calling. Have a great day!',

    endCallPhrases: [
      'goodbye',
      'bye bye',
      'talk to you later',
      'take care',
      'that\'s all I needed',
    ],

    // Silence detection — end call if caller goes silent for 30s
    silenceTimeoutSeconds: 30,

    // Max call duration: 10 minutes
    maxDurationSeconds: 600,

    // Background noise suppression
    backgroundDenoisingEnabled: true,

    // Post-call webhook — receives end-of-call report for call_logs
    serverUrl: `${backendUrl}/vapi/webhook`,
    serverUrlSecret: vapiSecret,

    // Metadata tag for routing/reporting
    metadata: {
      vertical: 'hvac',
      assistant_type: 'inbound_scheduling',
    },
  };
};
