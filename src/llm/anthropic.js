'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

/**
 * LLM adapter for the Anthropic API (native SDK).
 * Handles the message format differences between OpenAI and Anthropic:
 *   - system prompt passed as top-level param, not a message
 *   - tool results use role:'user' with content type 'tool_result'
 *   - tool definitions use input_schema instead of parameters
 *
 * Exposes the same interface as OpenAICompatAdapter.
 */
class AnthropicAdapter {
  constructor() {
    this.client = new Anthropic({ apiKey: config.llm.apiKey });
    this.model = config.llm.model || 'claude-opus-4-6';
  }

  _convertMessages(messages) {
    const converted = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // handled via system param

      if (msg.role === 'tool') {
        // Fold tool results into the previous user turn if possible,
        // otherwise create a new user turn
        const last = converted[converted.length - 1];
        const toolResult = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        };

        if (last && last.role === 'user' && Array.isArray(last.content)) {
          last.content.push(toolResult);
        } else {
          converted.push({ role: 'user', content: [toolResult] });
        }
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        // Convert tool_calls to Anthropic tool_use blocks
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
        converted.push({ role: 'assistant', content });
        continue;
      }

      converted.push({ role: msg.role, content: msg.content });
    }

    return converted;
  }

  _convertTools(tools) {
    if (!tools || tools.length === 0) return [];

    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  async chat({ messages, systemPrompt, tools }) {
    const params = {
      model: this.model,
      max_tokens: 1024,
      messages: this._convertMessages(messages),
    };
    if (systemPrompt) params.system = systemPrompt;
    const convertedTools = this._convertTools(tools);
    if (convertedTools.length > 0) params.tools = convertedTools;

    return this.client.messages.create(params);
  }

  async *stream({ messages, systemPrompt, tools }) {
    const params = {
      model: this.model,
      max_tokens: 1024,
      messages: this._convertMessages(messages),
      stream: true,
    };
    if (systemPrompt) params.system = systemPrompt;
    const convertedTools = this._convertTools(tools);
    if (convertedTools.length > 0) params.tools = convertedTools;

    const stream = this.client.messages.stream(params);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  extractToolCalls(response) {
    if (!response.content) return [];

    return response.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        id: b.id,
        name: b.name,
        arguments: b.input || {},
      }));
  }

  buildToolResult(toolCallId, content) {
    // Returns a message object that _convertMessages will handle on the next call
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
  }

  buildToolCallMessage(response) {
    // Convert Anthropic response to OpenAI-like assistant message for history tracking
    const toolCalls = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        id: b.id,
        type: 'function',
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input),
        },
      }));

    return {
      role: 'assistant',
      content: response.content.find(b => b.type === 'text')?.text || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  isToolCallResponse(response) {
    return response.stop_reason === 'tool_use';
  }

  getTextContent(response) {
    if (!response.content) return '';
    return response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
}

module.exports = AnthropicAdapter;
