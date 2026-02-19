'use strict';

const axios = require('axios');

const AUTH_URL = 'https://auth.servicetitan.io/connect/token';
const API_BASE = 'https://api.servicetitan.io';

/**
 * ServiceTitan CRM adapter.
 * credentials: { clientId, clientSecret, appKey, tenantId }
 * All four fields are required and come from clients.crm_credentials JSONB.
 */
class ServiceTitanAdapter {
  constructor(credentials) {
    this.credentials = credentials;
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  async _getToken() {
    if (this._accessToken && Date.now() < this._tokenExpiry - 30_000) {
      return this._accessToken;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    });

    const response = await axios.post(AUTH_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'ST-App-Key': this.credentials.appKey,
      },
    });

    this._accessToken = response.data.access_token;
    this._tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return this._accessToken;
  }

  async _request(method, path, data = null, params = null) {
    const token = await this._getToken();
    const url = `${API_BASE}${path.replace('{tenant}', this.credentials.tenantId)}`;

    const response = await axios({
      method,
      url,
      data,
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        'ST-App-Key': this.credentials.appKey,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }

  async getAvailability({ serviceType, date }) {
    const startDate = `${date}T00:00:00Z`;
    const endDate = `${date}T23:59:59Z`;

    const data = await this._request(
      'GET',
      '/scheduling/v2/tenant/{tenant}/capacity',
      null,
      { startsOnOrAfter: startDate, endsOnOrBefore: endDate }
    );

    return (data.data || []).map(slot => ({
      startTime: slot.start,
      endTime: slot.end,
      technicianName: slot.technician?.name || 'Available Technician',
    }));
  }

  async createJob({ customerId, serviceType, scheduledTime, estimatedDuration, requiresDeposit, notes }) {
    const data = await this._request('POST', '/jpm/v2/tenant/{tenant}/jobs', {
      customerId,
      scheduledDate: scheduledTime,
      duration: estimatedDuration,
      summary: notes || serviceType,
    });

    return {
      id: data.id,
      confirmationNumber: data.number || data.id,
    };
  }

  async lookupCustomer({ phone }) {
    const digits = phone.replace(/\D/g, '');

    const data = await this._request(
      'GET',
      '/crm/v2/tenant/{tenant}/customers',
      null,
      { phone: digits }
    );

    const customer = (data.data || [])[0];
    if (!customer) return null;

    return {
      id: customer.id,
      name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
      address: customer.address?.street || '',
      lastServiceDate: customer.lastServiceDate || null,
      equipment: (customer.equipment || []).map(e => e.name).filter(Boolean),
    };
  }
}

module.exports = ServiceTitanAdapter;
