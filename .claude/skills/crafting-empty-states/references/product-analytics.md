# Product Analytics Reference

## Contents
- Activation event logging
- Empty state impression tracking
- Funnel queries against call_logs
- Key metrics per surface
- Anti-patterns

---

## Activation Event Logging

There is no dedicated analytics library in this project. Use the structured logger (`src/utils/logger.js`) with consistent event names so logs can be queried in Railway's log viewer or forwarded to an external sink.

```javascript
// src/utils/logger.js usage — activation events
// Log on every meaningful state transition, not just errors

// Client onboarded
logger.info('activation.onboard', {
  client_id: clientId,
  vertical: vertical,
  tier: 'standard'
});

// First call received
logger.info('activation.first_call', {
  client_id: clientId,
  call_id: callId,
  duration_seconds: durationSeconds
});

// Wallet funded
logger.info('activation.wallet_funded', {
  client_id: clientId,
  amount_cents: amountCents,
  tier: tier
});

// FSM connected
logger.info('activation.fsm_connected', {
  client_id: clientId,
  integration_type: 'housecall_pro'
});
```

## Empty State Impression Tracking

Log whenever an empty state is returned — this is your signal for where clients get stuck in activation.

```javascript
// src/routes/dashboard.js — inside the calls route
if (result.rows.length === 0) {
  logger.info('empty_state.shown', {
    client_id: clientId,
    surface: 'call_logs',
    reason: 'no_calls_yet'
  });

  return res.json({
    calls: [],
    empty_state: { reason: 'no_calls_yet', action: 'configure_vapi' }
  });
}
```

```javascript
// Track wallet empty state
if (wallet.balance_cents === 0) {
  logger.info('empty_state.shown', {
    client_id: clientId,
    surface: 'wallet',
    reason: 'zero_balance'
  });
}
```

## Funnel Queries Against call_logs

Use PostgreSQL directly to measure activation funnels. Always scope by `client_id` — never aggregate across tenants without intent.

```javascript
// src/routes/dashboard.js — summary stats for a client
async function getClientSummary(clientId, pool) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE outcome = 'booked') AS bookings_count,
       COUNT(*) FILTER (WHERE outcome = 'transferred') AS transfers_count,
       COUNT(*) AS total_calls,
       SUM(duration_seconds) AS total_seconds,
       MAX(created_at) AS last_call_at
     FROM call_logs
     WHERE client_id = $1`,
    [clientId]
  );

  return result.rows[0];
}
```

```javascript
// Detect stalled clients — called zero times in last 7 days
// Run via a script or n8n scheduled workflow
async function getStalledClients(pool) {
  const result = await pool.query(
    `SELECT c.client_id, c.business_name, c.created_at
     FROM clients c
     WHERE c.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM call_logs cl
         WHERE cl.client_id = c.client_id
           AND cl.created_at > NOW() - INTERVAL '7 days'
       )`,
    []
  );
  return result.rows;
}
```

## Key Metrics Per Surface

| Surface | Metric | Query target |
|---------|--------|--------------|
| Call logs | First call received | `call_logs.created_at` MIN per client |
| Wallet | Days since last top-up | `wallet_transactions.created_at` |
| Bookings | Booking conversion rate | `call_logs WHERE outcome = 'booked'` / total |
| Config | Onboarding completion | `clients` fields + `client_integrations` |
| FSM | Booking confirmation rate | FSM-verified bookings / total attempted |

```javascript
// Booking conversion rate for a client
async function getBookingConversionRate(clientId, pool) {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS total_calls,
       COUNT(*) FILTER (WHERE outcome = 'booked') AS booked_calls
     FROM call_logs
     WHERE client_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
    [clientId]
  );

  const { total_calls, booked_calls } = result.rows[0];
  if (total_calls === 0) return null;
  return Math.round((booked_calls / total_calls) * 100);
}
```

## Anti-Patterns

### WARNING: Logging PII in analytics events

NEVER include caller phone numbers, names, or booking details in analytics log lines.

```javascript
// BAD
logger.info('activation.first_call', { client_id: clientId, caller_phone: fromPhone });

// GOOD — anonymized signal only
logger.info('activation.first_call', { client_id: clientId, call_id: callId });
```

### WARNING: Cross-tenant aggregate queries in routes

NEVER run analytics queries without a `WHERE client_id = $1` unless you're an internal admin script. A multi-tenant leak here exposes all clients' data to each other.

```javascript
// BAD — returns all clients' data
const result = await pool.query('SELECT COUNT(*) FROM call_logs WHERE outcome = $1', ['booked']);

// GOOD — scoped to tenant
const result = await pool.query(
  'SELECT COUNT(*) FROM call_logs WHERE client_id = $1 AND outcome = $2',
  [clientId, 'booked']
);
```

See the **postgresql** skill for parameterized query patterns and the **node** skill for structured logging setup.
