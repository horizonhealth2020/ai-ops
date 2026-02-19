'use strict';

const llm = require('../llm');
const toolRegistry = require('../tools/registry');

const MAX_TOOL_FAILURES = 2;
const MAX_LOOP_ITERATIONS = 10;

/**
 * Strip system messages from the Vapi message array.
 * System prompt is injected separately via the adapter.
 */
function stripSystemMessages(messages) {
  return messages.filter(m => m.role !== 'system');
}

/**
 * Run the agentic loop:
 *   1. Call LLM with current message history
 *   2. If the response contains tool calls, execute them and loop
 *   3. If terminal tool (transfer_call) is called, stream a transfer notice and stop
 *   4. When LLM produces a final text response, stream it to Vapi
 *
 * @param {object} options
 * @param {object} options.client       - resolved tenant record
 * @param {Array}  options.messages     - conversation history from Vapi (OpenAI format)
 * @param {string} options.systemPrompt - assembled system prompt (null if not first turn)
 * @param {Function} options.onChunk    - called with each text chunk to stream to Vapi
 * @param {Function} options.onDone     - called when streaming is complete
 */
async function run({ client, messages, systemPrompt, onChunk, onDone }) {
  const adapter = llm.getAdapter();
  const tools = toolRegistry.getDefs();

  let history = stripSystemMessages(messages);
  const toolFailures = {};
  let iterations = 0;

  while (iterations < MAX_LOOP_ITERATIONS) {
    iterations++;

    const response = await adapter.chat({
      messages: history,
      systemPrompt: iterations === 1 ? systemPrompt : undefined,
      tools,
    });

    // ─── Tool call turn ───────────────────────────────────────────────────────
    if (adapter.isToolCallResponse(response)) {
      const toolCalls = adapter.extractToolCalls(response);

      // Append the assistant's tool call message to history
      history.push(adapter.buildToolCallMessage(response));

      for (const tc of toolCalls) {
        let result;

        try {
          result = await toolRegistry.execute(tc.name, tc.arguments, client);
          toolFailures[tc.name] = 0;
        } catch (err) {
          toolFailures[tc.name] = (toolFailures[tc.name] || 0) + 1;
          result = { error: err.message };

          if (toolFailures[tc.name] >= MAX_TOOL_FAILURES) {
            // Force escalation
            const escalationResult = await toolRegistry.execute(
              'transfer_call',
              {
                reason: `Tool "${tc.name}" failed ${MAX_TOOL_FAILURES} times`,
                summary: `The AI encountered a technical issue with ${tc.name}. Please assist the caller manually.`,
                priority: 'normal',
              },
              client
            );
            onChunk(
              `I'm sorry, I'm having a technical issue. Let me connect you with one of our team members right away.`
            );
            onDone(escalationResult);
            return;
          }
        }

        // Check if this is a terminal tool (e.g., transfer_call)
        if (toolRegistry.isTerminal(tc.name)) {
          const text = result.priority === 'emergency'
            ? 'This sounds like an emergency. I\'m connecting you with a technician right now.'
            : 'Of course, let me connect you with a member of our team right now.';
          onChunk(text);
          onDone(result);
          return;
        }

        // Append tool result to history
        history.push(adapter.buildToolResult(tc.id, result));
      }

      // Continue the loop — LLM will process the tool results
      continue;
    }

    // ─── Final text turn — stream to Vapi ────────────────────────────────────
    const finalText = adapter.getTextContent(response);

    if (!finalText) {
      onChunk("I'm sorry, I didn't get a response. Could you please repeat that?");
      onDone();
      return;
    }

    // Stream using the adapter's native streaming for real-time voice synthesis
    try {
      const streamHistory = [...history];
      // Append a user nudge to get the same response via streaming
      // Better approach: stream from the start on final turn
      for await (const chunk of adapter.stream({
        messages: history,
        systemPrompt: iterations === 1 ? systemPrompt : undefined,
        tools: [],  // no tools on final streaming call
      })) {
        onChunk(chunk);
      }
    } catch {
      // Fallback: send the already-fetched text
      onChunk(finalText);
    }

    onDone();
    return;
  }

  // Safety: max iterations exceeded
  onChunk("I'm sorry, I'm having trouble processing your request. Let me transfer you to a team member.");
  onDone();
}

module.exports = { run };
