'use strict';

const REQUIRED = ['DATABASE_URL', 'VAPI_SECRET', 'LLM_API_KEY', 'STRIPE_SECRET_KEY'];

const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  mistral: 'https://api.mistral.ai/v1',
  ollama: 'http://localhost:11434/v1',
  anthropic: null, // uses native SDK
  custom: null,    // requires LLM_BASE_URL
};

function validate() {
  const provider = process.env.LLM_PROVIDER || 'openai';
  const missing = [];

  // API key not required for Ollama
  const required = provider === 'ollama'
    ? REQUIRED.filter(k => k !== 'LLM_API_KEY')
    : REQUIRED;

  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }

  if (provider === 'custom' && !process.env.LLM_BASE_URL) {
    missing.push('LLM_BASE_URL (required when LLM_PROVIDER=custom)');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

const provider = process.env.LLM_PROVIDER || 'openai';

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  databaseUrl: process.env.DATABASE_URL,

  vapiSecret: process.env.VAPI_SECRET,

  llm: {
    provider,
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o',
    baseUrl: process.env.LLM_BASE_URL || PROVIDER_BASE_URLS[provider] || PROVIDER_BASE_URLS.openai,
  },

  stripeSecretKey: process.env.STRIPE_SECRET_KEY,

  validate,
};

module.exports = config;
