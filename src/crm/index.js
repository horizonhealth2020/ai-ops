'use strict';

const ServiceTitanAdapter = require('./serviceTitan');
const StubAdapter = require('./stub');

/**
 * Returns the appropriate CRM adapter instance for the given platform.
 * @param {string} platform - crm_platform value from clients table
 * @param {object} credentials - crm_credentials JSONB from clients table
 */
function getAdapter(platform, credentials) {
  switch (platform) {
    case 'servicetitan':
      return new ServiceTitanAdapter(credentials || {});
    case 'stub':
    default:
      return new StubAdapter();
  }
}

module.exports = { getAdapter };
