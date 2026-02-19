'use strict';

const crm = require('../crm');

const toolDef = {
  name: 'lookup_customer',
  description: 'Look up an existing customer by their phone number to retrieve their profile and service history.',
  parameters: {
    type: 'object',
    properties: {
      phone_number: {
        type: 'string',
        description: 'The caller phone number to look up (digits only or with formatting)',
      },
    },
    required: ['phone_number'],
  },
};

async function execute({ phone_number }, client) {
  const adapter = crm.getAdapter(client.crm_platform, client.crm_credentials);
  const customer = await adapter.lookupCustomer({ phone: phone_number });

  if (!customer) {
    return { found: false, message: 'No existing customer record found. Proceed as a new customer.' };
  }

  return {
    found: true,
    customer_id: customer.id,
    name: customer.name,
    address: customer.address,
    last_service_date: customer.lastServiceDate,
    equipment_on_file: customer.equipment || [],
  };
}

module.exports = { execute, toolDef };
