'use strict';

const crm = require('../crm');
const servicesDb = require('../db/queries/services');

const toolDef = {
  name: 'create_job',
  description: 'Create a service visit record. Call this after confirming date, time, and customer details.',
  parameters: {
    type: 'object',
    properties: {
      service_type: {
        type: 'string',
        description: 'The service to be performed',
      },
      appointment_time: {
        type: 'string',
        description: 'Appointment start time in ISO 8601 format (e.g., 2025-03-15T09:00:00)',
      },
      customer_id: {
        type: 'string',
        description: 'Customer ID from lookup_customer. Use "new" if this is a new customer.',
      },
      customer_name: {
        type: 'string',
        description: 'Full name of the customer',
      },
      customer_phone: {
        type: 'string',
        description: 'Customer callback phone number',
      },
      service_address: {
        type: 'string',
        description: 'Full service address',
      },
      notes: {
        type: 'string',
        description: 'Any notes from the caller about the issue or special instructions',
      },
    },
    required: ['service_type', 'appointment_time', 'customer_name', 'customer_phone', 'service_address'],
  },
};

async function execute({ service_type, appointment_time, customer_id, customer_name, customer_phone, service_address, notes }, client) {
  const adapter = crm.getAdapter(client.crm_platform, client.crm_credentials);

  const service = await servicesDb.findByClientAndName(client.id, service_type);

  const job = await adapter.createJob({
    customerId: customer_id === 'new' ? null : customer_id,
    serviceType: service_type,
    scheduledTime: appointment_time,
    estimatedDuration: service?.duration_minutes || 60,
    requiresDeposit: service?.requires_deposit || false,
    notes: notes || `Service: ${service_type} at ${service_address} for ${customer_name} (${customer_phone})`,
  });

  return {
    success: true,
    job_id: job.id,
    confirmation_number: job.confirmationNumber,
    requires_deposit: service?.requires_deposit || false,
    deposit_amount: service?.requires_deposit ? (service.base_price * 0.25).toFixed(2) : null,
  };
}

module.exports = { execute, toolDef };
