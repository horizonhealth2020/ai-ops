'use strict';

/**
 * Vapi assistant configuration for the Plumbing vertical.
 * Name: Sam — calm, reassuring, decisive under pressure.
 * Leads with emergency triage before moving to scheduling.
 */
module.exports = function plumbingAssistant({ backendUrl, vapiSecret }) {
  return {
    name: 'Sam - Plumbing Service Assistant',

    model: {
      provider: 'custom-llm',
      url: `${backendUrl}/vapi/chat`,
      model: 'custom',
      systemPrompt: '',
      temperature: 0.3, // slightly lower — plumbing calls need precision
    },

    voice: {
      provider: '11labs',
      voiceId: 'VR6AewLTigWG4xSOukaG', // Arnold — calm, trustworthy, reassuring
      stability: 0.6,
      similarityBoost: 0.8,
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
      "Thanks for calling! I'm Sam. First — is this an emergency like a burst pipe or active flooding, or are you looking to schedule a service?",

    firstMessageMode: 'assistant-speaks-first',

    endCallMessage: 'Thank you for calling. Help is on the way — stay safe!',

    endCallPhrases: [
      'goodbye',
      'bye',
      'thank you',
      'thanks',
      'that\'s all',
    ],

    silenceTimeoutSeconds: 25, // shorter — emergencies need fast response

    maxDurationSeconds: 600,

    backgroundDenoisingEnabled: true,

    serverUrl: `${backendUrl}/vapi/webhook`,
    serverUrlSecret: vapiSecret,

    metadata: {
      vertical: 'plumbing',
      assistant_type: 'inbound_scheduling',
    },
  };
};
