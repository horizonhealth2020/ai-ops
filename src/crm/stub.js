'use strict';

/**
 * Stub CRM adapter — returns deterministic fake data.
 * Used in development and for demo clients where crm_platform = 'stub'.
 */
class StubAdapter {
  async getAvailability({ serviceType, date }) {
    return [
      { startTime: `${date}T09:00:00`, endTime: `${date}T10:00:00`, technicianName: 'Mike T.' },
      { startTime: `${date}T13:00:00`, endTime: `${date}T14:00:00`, technicianName: 'Sara L.' },
      { startTime: `${date}T15:30:00`, endTime: `${date}T16:30:00`, technicianName: 'James R.' },
    ];
  }

  async createJob({ customerId, serviceType, scheduledTime, estimatedDuration, notes }) {
    const jobId = `stub-job-${Date.now()}`;
    const confirmationNumber = `CONF-${Math.floor(Math.random() * 900000) + 100000}`;
    return { id: jobId, confirmationNumber };
  }

  async lookupCustomer({ phone }) {
    // Numbers ending in 0000 simulate "new customer not found"
    if (phone.replace(/\D/g, '').endsWith('0000')) return null;

    return {
      id: 'stub-customer-1',
      name: 'Alex Demo',
      address: '123 Elm Street',
      lastServiceDate: '2024-09-15',
      equipment: ['Carrier 3-ton AC Unit (2019)', 'Carrier Gas Furnace (2019)'],
    };
  }
}

module.exports = StubAdapter;
