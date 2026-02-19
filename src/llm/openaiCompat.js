'use strict';

const OpenAI = require('openai');
const config = require('../config');

const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  mistral: 'https://api.mistral.ai/v1',
  ollama: 'http://localhost:11434/v1',
};

/**
 * LLM adapter for any OpenAI-compatible provider.
 * Covers: OpenAI, Groq, Together AI, Mistral, Ollama, custom endpoints.
 *
 * Interface:
 *   chat({ messages, systemPrompt, tools })          → full response object
 *   stream({ messages, systemPrompt, tools })        → async iterable of text chunks
 *   extractToolCalls(response)                       → [{ id, name, arguments }]
 *   buildToolResult(toolCallId, content)             → message object to append
 *   buildToolCallMessage(toolCalls, responseContent) → message object to append
 */
class OpenAICompatAdapter {
  constructor(provider) {
    const baseURL = config.llm.baseUrl ||
      PROVIDER_BASE_URLS[provider] ||
      PROVIDER_BASE_URLS.openai;

    this.client = new OpenAI({
      apiKey: config.llm.apiKey || 'ollama', // Ollama ignores the key
      baseURL,
    });

    this.model = config.llm.model;
  }

  _buildParams(messages, systemPrompt, tools) {
    const fullMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const params = {
      model: this.model,
      messages: fullMessages,
      temperature: 0.4,
    };

    if (tools && tools.length > 0) {
      params.tools = tools.map(t => ({ type: 'function', function: t }));
      params.tool_choice = 'auto';
    }

    return params;
  }

  async chat({ messages, systemPrompt, tools }) {
    const params = this._buildParams(messages, systemPrompt, tools);
    return this.client.chat.completions.create(params);
  }

  async *stream({ messages, systemPrompt, tools }) {
    const params = {
      ...this._buildParams(messages, systemPrompt, tools),
      stream: true,
    };

    const stream = await this.client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield delta.content;
      }
    }
  }

  extractToolCalls(response) {
    const message = response.choices[0]?.message;
    if (!message?.tool_calls || message.tool_calls.length === 0) return [];

    return message.tool_calls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}'),
    }));
  }

  buildToolResult(toolCallId, content) {
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
  }

  buildToolCallMessage(response) {
    return response.choices[0].message;
  }

  isToolCallResponse(response) {
    return response.choices[0]?.finish_reason === 'tool_calls';
  }

  getTextContent(response) {
    return response.choices[0]?.message?.content || '';
  }
}

module.exports = OpenAICompatAdapter;
