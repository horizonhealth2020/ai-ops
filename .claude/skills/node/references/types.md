# Node Types Reference

## Contents
- Runtime Data Conventions
- Money (Cents)
- Phone Numbers (E.164)
- Dates and Timestamps
- Client Config Shape
- Redis Value Serialization

---

## Runtime Data Conventions

This project uses plain JavaScript. No TypeScript. Document expected shapes with JSDoc when the structure is non-obvious.

```javascript
/**
 * @param {string} clientId - UUID v4
 * @param {string} callerPhone - E.164 format (+1XXXXXXXXXX)
 * @returns {Promise<{name: string, lastVisit: string|null}>}
 */
async function lookupCaller(clientId, callerPhone) { ... }
```

## Money (Cents)

**NEVER use floats for currency.** All wallet balances, transaction amounts, and pricing are stored and computed as integers (cents).

```javascript
// GOOD
const balanceCents = 4000;           // $40.00
const rateCents = 40;                // $0.40/min standard tier
const chargeCents = durationMin * rateCents;

// GOOD — display formatting in formatters.js
function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// BAD — float arithmetic corrupts money
const balance = 40.00;
const rate = 0.40;
const charge = duration * rate; // 0.1 + 0.2 = 0.30000000000000004
```

Pricing tiers (cents per minute):

| Tier | Rate (cents/min) |
|------|-----------------|
| standard | 40 |
| growth | 32 |
| scale | 27 |
| enterprise | 23 |

## Phone Numbers (E.164)

All phone numbers stored and compared in E.164 format. Multi-tenant routing depends on exact string matches.

```javascript
// GOOD — stored in DB, compared as-is
const clientPhone = '+19545550100';

// GOOD — format on ingest from Vapi/Twilio
function toE164(raw) {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

// BAD — inconsistent format breaks WHERE phone = $1 lookups
const phone = '9545550100';     // missing +1
const phone = '(954) 555-0100'; // formatted display string
```

## Dates and Timestamps

Use ISO 8601 strings for slot dates (`YYYY-MM-DD`) and ISO timestamps for logs.

```javascript
// Slot date (availability check)
const slotDate = '2026-03-15';
const slotTime = '09:00';
const redisKey = `hold:${clientId}:${slotDate}:${slotTime}`;

// Timestamps in logs and DB
const now = new Date().toISOString(); // '2026-03-12T14:30:00.000Z'

// Timezone-aware business hours check — use timeUtils.js
const { isWithinBusinessHours } = require('../utils/timeUtils');
const isOpen = isWithinBusinessHours(client.business_hours, client.timezone);
```

## Client Config Shape

The shape returned from `client_config:{clientId}` Redis cache and the `clients` table:

```javascript
// Expected shape from getClientConfig()
{
  client_id: 'uuid-v4',
  company_name: 'Apex Plumbing & HVAC',
  phone_number: '+19545550100',
  vertical: 'hvac',           // hvac | spa | electrical | plumbing | restaurant | cleaning
  billing_tier: 'standard',   // standard | growth | scale | enterprise
  system_prompt: '...',       // pre-compiled, stored in DB
  business_hours: { mon: { open: '08:00', close: '17:00' }, ... },
  timezone: 'America/New_York',
  is_active: true,
  wallet_balance_cents: 4000,
}
```

## Redis Value Serialization

Redis stores strings only. Always `JSON.stringify` objects, `JSON.parse` on retrieval.

```javascript
// GOOD — explicit serialization
await redis.set(
  `client_config:${clientId}`,
  JSON.stringify(config),
  'EX', 300
);
const raw = await redis.get(`client_config:${clientId}`);
const config = raw ? JSON.parse(raw) : null;

// BAD — ioredis auto-stringifies with [object Object]
await redis.set(`client_config:${clientId}`, config); // stores "[object Object]"
```

Simple scalar values (hold keys, tokens) are stored as plain strings without JSON:

```javascript
// Hold key value is just the callId string
await redis.set(`hold:${clientId}:${date}:${time}`, callId, 'NX', 'EX', 300);
```
