'use strict';

const crm = require('../crm');

const toolDef = {
  name: 'check_availability',
  description: 'Check available appointment slots for a service type on a preferred date.',
  parameters: {
    type: 'object',
    properties: {
      service_type: {
        type: 'string',
        description: 'The type of service requested (e.g., "AC Tune-Up", "Drain Clearing")',
      },
      preferred_date: {
        type: 'string',
        description: 'Preferred date in YYYY-MM-DD format',
      },
    },
    required: ['service_type', 'preferred_date'],
  },
};

async function execute({ service_type, preferred_date }, client) {
  const adapter = crm.getAdapter(client.crm_platform, client.crm_credentials);
  const slots = await adapter.getAvailability({ serviceType: service_type, date: preferred_date, clientId: client.id });

  if (!slots || slots.length === 0) {
    return {
      available: false,
      message: `No availability for ${service_type} on ${preferred_date}. Ask the caller for alternate dates.`,
    };
  }

  return {
    available: true,
    date: preferred_date,
    service_type,
    slots: slots.map(s => ({
      time: s.startTime,
      end_time: s.endTime,
      technician: s.technicianName,
    })),
  };
}

module.exports = { execute, toolDef };
