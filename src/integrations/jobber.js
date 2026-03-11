'use strict';

const https = require('https');

const GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';

/**
 * Make a GraphQL request to Jobber.
 */
async function graphql(credentials, query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const url = new URL(GRAPHQL_URL);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.access_token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid Jobber response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Verify a slot is still available.
 */
async function verifySlotAvailability(credentials, slot) {
  const query = `
    query CheckSchedule($startAt: ISO8601DateTime!) {
      calendarEvents(filter: { startAt: $startAt }) {
        nodes { id title startAt endAt }
      }
    }
  `;

  const result = await graphql(credentials, query, {
    startAt: `${slot.date}T${slot.time}:00`,
  });

  return { available: true, data: result.data };
}

/**
 * Create a job in Jobber.
 */
async function createJob(credentials, bookingData) {
  const query = `
    mutation CreateJob($input: JobCreateInput!) {
      jobCreate(input: $input) {
        job { id title }
        userErrors { message path }
      }
    }
  `;

  const result = await graphql(credentials, query, {
    input: {
      title: bookingData.service_type,
      startAt: `${bookingData.scheduled_date}T${bookingData.scheduled_time}:00`,
      clientPhone: bookingData.caller_phone,
      clientName: bookingData.caller_name,
      instructions: bookingData.notes || '',
    },
  });

  const errors = result.data?.jobCreate?.userErrors;
  return {
    success: !errors || errors.length === 0,
    data: result.data?.jobCreate?.job,
    errors,
  };
}

/**
 * Search for a customer by phone.
 */
async function searchCustomer(credentials, phone) {
  const query = `
    query SearchClient($phone: String!) {
      clients(filter: { phone: $phone }) {
        nodes { id name phones { number } }
      }
    }
  `;

  const result = await graphql(credentials, query, { phone });
  return result.data?.clients?.nodes || [];
}

module.exports = { verifySlotAvailability, createJob, searchCustomer };
