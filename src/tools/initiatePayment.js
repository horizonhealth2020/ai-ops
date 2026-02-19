'use strict';

const Stripe = require('stripe');
const config = require('../config');

const toolDef = {
  name: 'initiate_payment',
  description: 'Initiate a payment session for a deposit or service fee. Returns a session token for DTMF card entry.',
  parameters: {
    type: 'object',
    properties: {
      amount_dollars: {
        type: 'number',
        description: 'The amount to charge in dollars (e.g., 87.50)',
      },
      customer_name: {
        type: 'string',
        description: 'Full name of the customer being charged',
      },
      description: {
        type: 'string',
        description: 'Description of what is being charged (e.g., "Deposit for AC installation")',
      },
      job_id: {
        type: 'string',
        description: 'The job ID this payment is associated with',
      },
    },
    required: ['amount_dollars', 'customer_name', 'description'],
  },
};

async function execute({ amount_dollars, customer_name, description, job_id }, client) {
  const stripe = new Stripe(config.stripeSecretKey);

  const amountCents = Math.round(amount_dollars * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    description,
    metadata: {
      client_id: client.id,
      company_name: client.company_name,
      customer_name,
      job_id: job_id || '',
    },
  });

  return {
    success: true,
    session_token: paymentIntent.client_secret,
    payment_intent_id: paymentIntent.id,
    amount_dollars,
    instructions: `Please ask the caller to enter their ${amount_dollars.toFixed(2)} dollar payment using their phone keypad.`,
  };
}

module.exports = { execute, toolDef };
