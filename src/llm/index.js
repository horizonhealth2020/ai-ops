'use strict';

const config = require('../config');

let _adapter = null;

/**
 * Returns the singleton LLM adapter based on LLM_PROVIDER env var.
 *
 * Supported providers:
 *   openai     → OpenAI (gpt-4o, gpt-4-turbo, etc.)
 *   groq       → Groq (llama-3.3-70b-versatile, mixtral-8x7b, etc.)
 *   together   → Together AI
 *   mistral    → Mistral AI
 *   ollama     → Local Ollama (no API key needed)
 *   custom     → Any OpenAI-compatible endpoint via LLM_BASE_URL
 *   anthropic  → Anthropic (claude-opus-4-6, claude-sonnet-4-6, etc.)
 */
function getAdapter() {
  if (_adapter) return _adapter;

  const provider = config.llm.provider;

  if (provider === 'anthropic') {
    const AnthropicAdapter = require('./anthropic');
    _adapter = new AnthropicAdapter();
  } else {
    const OpenAICompatAdapter = require('./openaiCompat');
    _adapter = new OpenAICompatAdapter(provider);
  }

  return _adapter;
}

module.exports = { getAdapter };
