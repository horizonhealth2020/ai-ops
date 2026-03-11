'use strict';

const https = require('https');
const redis = require('../config/redis');

const AUTH_URL = 'https://auth.servicetitan.io/connect/token';
const API_BASE = 'https://api.servicetitan.io';

/**
 * Get or refresh OAuth2 token with Redis caching.
 */
async function getToken(credentials) {
  const cacheKey = credentials.token_cache_key || `st_token:${credentials.client_id}`;

  // Check Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch {}

  // Request new token
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
  }).toString();

  const token = await new Promise((resolve, reject) => {
    const url = new URL(AUTH_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.access_token);
        } catch {
          reject(new Error('Failed to parse ServiceTitan token response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // Cache token (3500s < 1 hour token lifetime)
  try {
    await redis.set(cacheKey, token, 'EX', 3500);
  } catch {}

  return token;
}

/**
 * Make an authenticated API request.
 */
async function request(credentials, method, path, body = null) {
  const token = await getToken(credentials);
  const tenantId = credentials.tenant_id;
  const url = new URL(`${API_BASE}/v2/tenant/${tenantId}${path}`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'ST-App-Key': credentials.app_key,
      },
    };

    const req = https.request(options, (res) => {
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

async function verifySlotAvailability(credentials, slot) {
  const resp = await request(credentials, 'GET',
    `/dispatch/slots?date=${slot.date}&time=${slot.time}`);
  return { available: resp.status === 200, data: resp.data };
}

async function createJob(credentials, bookingData) {
  const resp = await request(credentials, 'POST', '/jpm/jobs', {
    customerName: bookingData.caller_name,
    customerPhone: bookingData.caller_phone,
    address: bookingData.caller_address,
    jobTypeName: bookingData.service_type,
    scheduledDate: bookingData.scheduled_date,
    scheduledTime: bookingData.scheduled_time,
    summary: bookingData.notes || '',
  });
  return { success: resp.status === 200 || resp.status === 201, data: resp.data };
}

async function searchCustomer(credentials, phone) {
  const resp = await request(credentials, 'GET',
    `/crm/customers?phone=${encodeURIComponent(phone)}`);
  return resp.data;
}

module.exports = { verifySlotAvailability, createJob, searchCustomer };
