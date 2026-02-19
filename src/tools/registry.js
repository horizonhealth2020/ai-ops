'use strict';

const checkAvailability = require('./checkAvailability');
const createJob = require('./createJob');
const lookupCustomer = require('./lookupCustomer');
const initiatePayment = require('./initiatePayment');
const transferCall = require('./transferCall');
const logUnansweredQuestion = require('./logUnansweredQuestion');

const TOOLS = {
  check_availability: checkAvailability,
  create_job: createJob,
  lookup_customer: lookupCustomer,
  initiate_payment: initiatePayment,
  transfer_call: transferCall,
  log_unanswered_question: logUnansweredQuestion,
};

/**
 * Execute a tool by name.
 * @param {string} toolName
 * @param {object} input - parsed arguments from the LLM
 * @param {object} client - resolved tenant object
 * @returns {Promise<object>} tool result
 */
async function execute(toolName, input, client) {
  const handler = TOOLS[toolName];
  if (!handler) throw new Error(`Unknown tool: "${toolName}"`);
  return handler.execute(input, client);
}

/**
 * Returns tool definitions in OpenAI function format.
 * The LLM adapters handle any provider-specific translation.
 */
function getDefs() {
  return Object.values(TOOLS).map(h => h.toolDef);
}

/**
 * Check if a tool is marked as terminal (should stop the agent loop).
 */
function isTerminal(toolName) {
  return TOOLS[toolName]?.toolDef?.terminal === true;
}

module.exports = { execute, getDefs, isTerminal };
