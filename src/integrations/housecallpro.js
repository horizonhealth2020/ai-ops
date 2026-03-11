'use strict';

const https = require('https');

const BASE_URL = 'https://api.housecallpro.com/v1';

/**
 * Make an authenticated request to HouseCall Pro API.
 */
async function request(credentials, method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${credentials.api_key}`,
      'Content-Type': 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Verify a slot is still available in HouseCall Pro.
 */
async function verifySlotAvailability(credentials, slot) {
  // HouseCall Pro doesn't have a direct slot check — check schedule
  const dateStr = slot.date;
  const resp = await request(credentials, 'GET', `/schedule?date=${dateStr}`);

  if (resp.status !== 200) {
    return { available: false, error: 'Failed to check HouseCall Pro schedule' };
  }

  return { available: true, data: resp.data };
}

/**
 * Create a job in HouseCall Pro.
 */
async function createJob(credentials, bookingData) {
  const body = {
    customer: {
      first_name: bookingData.caller_name.split(' ')[0],
      last_name: bookingData.caller_name.split(' ').slice(1).join(' ') || '',
      phone_numbers: [{ number: bookingData.caller_phone, type: 'mobile' }],
      addresses: bookingData.caller_address ? [{ street: bookingData.caller_address }] : [],
    },
    scheduled_start: `${bookingData.scheduled_date}T${bookingData.scheduled_time}:00`,
    job_type: bookingData.fsm_job_type_id || undefined,
    notes: bookingData.notes || '',
  };

  const resp = await request(credentials, 'POST', '/jobs', body);
  return { success: resp.status === 201 || resp.status === 200, data: resp.data };
}

/**
 * Search for a customer by phone in HouseCall Pro.
 */
async function searchCustomer(credentials, phone) {
  const resp = await request(credentials, 'GET', `/customers?phone=${encodeURIComponent(phone)}`);
  return resp.data;
}

module.exports = { verifySlotAvailability, createJob, searchCustomer };
