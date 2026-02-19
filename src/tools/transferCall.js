'use strict';

const toolDef = {
  name: 'transfer_call',
  description: 'Transfer the caller to a live human agent. Use when the caller requests a human, when a tool fails repeatedly, or for emergencies.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Brief reason for the transfer (e.g., "caller requested human", "emergency", "tool failure")',
      },
      summary: {
        type: 'string',
        description: 'A concise handoff summary for the receiving agent: what the caller needs and any info collected',
      },
      priority: {
        type: 'string',
        enum: ['normal', 'emergency'],
        description: 'Transfer priority. Use "emergency" for burst pipes, gas leaks, carbon monoxide, or other safety issues.',
      },
    },
    required: ['reason', 'summary'],
  },
  // Signals the agent loop to exit immediately after executing this tool
  terminal: true,
};

async function execute({ reason, summary, priority }, client) {
  return {
    action: 'transfer',
    transfer_to: client.call_config.transfer_number,
    priority: priority || 'normal',
    reason,
    handoff_summary: summary,
  };
}

module.exports = { execute, toolDef };
