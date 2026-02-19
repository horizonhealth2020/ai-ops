'use strict';

const templateLoader = require('../templates/loader');

/**
 * Build the interpolation context from a resolved client record.
 */
function buildContext(client) {
  const cfg = client.call_config || {};
  const services = Array.isArray(client.services) ? client.services : [];

  const servicesList = services.length > 0
    ? services.map(s => {
        const price = s.base_price ? `$${Number(s.base_price).toFixed(2)}` : 'Call for pricing';
        const duration = s.duration_minutes ? `${s.duration_minutes} min` : '';
        const deposit = s.requires_deposit ? ' [deposit required]' : '';
        return `- ${s.service_name}: ${price}${duration ? `, ${duration}` : ''}${deposit}`;
      }).join('\n')
    : 'Contact us for a full list of available services.';

  const faqContent = cfg.faq_content && typeof cfg.faq_content === 'object'
    ? Object.entries(cfg.faq_content)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')
    : '';

  return {
    company_name: client.company_name || 'our company',
    industry: client.industry_vertical || '',
    tone: cfg.tone_override || 'professional, friendly, and helpful',
    after_hours_behavior: cfg.after_hours_behavior || 'voicemail',
    transfer_number: cfg.transfer_number || 'our main line',
    emergency_keywords: Array.isArray(cfg.emergency_keywords)
      ? cfg.emergency_keywords.join(', ')
      : '',
    faq_content: faqContent,
    services_list: servicesList,
  };
}

/**
 * Replace all {{variable}} occurrences in a template string.
 */
function interpolate(template, context) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in context ? context[key] : match;
  });
}

/**
 * Assemble the full system prompt for a client.
 * @param {object} client - resolved tenant record
 * @returns {string} assembled system prompt
 */
function assemble(client) {
  const template = templateLoader.load(client.industry_vertical);
  const context = buildContext(client);
  return interpolate(template, context);
}

module.exports = { assemble };
