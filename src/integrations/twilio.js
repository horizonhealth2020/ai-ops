'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');

let twilioClient = null;

function getClient() {
  if (!twilioClient && env.twilioAccountSid && env.twilioAuthToken) {
    const twilio = require('twilio');
    twilioClient = twilio(env.twilioAccountSid, env.twilioAuthToken);
  }
  return twilioClient;
}

/**
 * Send an SMS message.
 *
 * @param {string} to - E.164 phone number
 * @param {string} body - message body
 * @returns {object|null} message SID or null if Twilio not configured
 */
async function sendSms(to, body) {
  const client = getClient();
  if (!client) {
    logger.warn('Twilio not configured, SMS not sent', { to });
    return null;
  }

  const message = await client.messages.create({
    from: env.twilioPhoneNumber,
    to,
    body,
  });

  return { sid: message.sid };
}

/**
 * Send a payment link via SMS.
 */
async function sendPaymentLink(to, paymentLink, description) {
  return sendSms(to, `Here's your payment link for ${description}: ${paymentLink}`);
}

module.exports = { sendSms, sendPaymentLink };
