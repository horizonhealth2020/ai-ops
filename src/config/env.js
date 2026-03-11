'use strict';

const REQUIRED_CORE = [
  'PGBOUNCER_URL',
  'REDIS_URL',
  'VAPI_API_KEY',
  'OPENAI_API_KEY',
];

function validate() {
  const missing = REQUIRED_CORE.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  pgbouncerUrl: process.env.PGBOUNCER_URL,
  databaseUrl: process.env.DATABASE_URL, // direct connection for migrations only

  // Redis
  redisUrl: process.env.REDIS_URL,

  // Vapi
  vapiApiKey: process.env.VAPI_API_KEY,

  // OpenAI (LLM proxy)
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',

  // Stripe (platform account)
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

  // Twilio (platform account)
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,

  // Clerk (dashboard auth)
  clerkSecretKey: process.env.CLERK_SECRET_KEY,

  // n8n
  n8nWebhookBaseUrl: process.env.N8N_WEBHOOK_BASE_URL,

  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY,

  validate,
};

module.exports = env;
