'use strict';

/**
 * Vapi assistant configuration for the Spa vertical.
 * Name: Lily — warm, soothing, unhurried.
 * Focused on creating a relaxing booking experience.
 */
module.exports = function spaAssistant({ backendUrl, vapiSecret }) {
  return {
    name: 'Lily - Spa Booking Assistant',

    model: {
      provider: 'custom-llm',
      url: `${backendUrl}/vapi/chat`,
      model: 'custom',
      systemPrompt: '',
      temperature: 0.5, // slightly warmer/more natural for spa context
    },

    voice: {
      provider: '11labs',
      voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella — warm, smooth, soothing female
      stability: 0.65,
      similarityBoost: 0.85,
      style: 0.1,
      useSpeakerBoost: false,
    },

    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en-US',
      smartFormat: true,
    },

    firstMessage:
      "Thank you for calling! I'm Lily, your booking assistant. I'd love to help you find the perfect treatment. What kind of experience are you looking for today?",

    firstMessageMode: 'assistant-speaks-first',

    endCallMessage:
      "Thank you for calling. We look forward to seeing you — have a wonderful day!",

    endCallPhrases: [
      'goodbye',
      'bye',
      'thank you so much',
      'that\'s everything',
      'take care',
    ],

    silenceTimeoutSeconds: 35, // slightly longer — spa calls are relaxed, unhurried

    maxDurationSeconds: 600,

    backgroundDenoisingEnabled: true,

    serverUrl: `${backendUrl}/vapi/webhook`,
    serverUrlSecret: vapiSecret,

    metadata: {
      vertical: 'spa',
      assistant_type: 'inbound_booking',
    },
  };
};
