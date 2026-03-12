# Activation & Onboarding Events

Activation milestones mark the first time a client completes a meaningful
step. They are one-time events — deduplicated by checking existence before
firing. All events are emitted at the route layer, never inside services.

> WARNING: There is no analytics SDK in this project's dependencies.
> `npm install posthog-node` is the recommended first step. Until then,
> use the `logEvent()` helper below which writes to structured logs and
> forwards to n8n for downstream processing.

---

## Activation Milestones

| Event | Trigger | Route |
|---|---|---|
| `client_onboarded` | Client record created | POST /api/v1/onboard |
| `wallet_funded` | First wallet top-up recorded | wallet_transactions INSERT |
| `first_call_answered` | First call_logs row for client | POST /api/v1/call/complete |
| `first_booking_created` | First bookings row for client | POST /api/v1/booking/create |
| `fsm_integration_configured` | client_integrations row is_active=true | POST /api/v1/onboard |

---

## logEvent() Helper

Define this in `src/utils/analytics.js` and import it only in route files.

```javascript
'use strict';

const logger = require('./logger');
const { fireN8nWebhook } = require('../services/bookingService');

/**
 * Emit a structured product event.
 * Writes to structured logs and fans out to n8n webhook (fire-and-forget).
 *
 * @param {string} event   - snake_case event name
 * @param {object} props   - must include client_id
 */
function logEvent(event, props) {
  if (!props.client_id) {
    logger.warn('logEvent called without client_id', { event });
    return;
  }

  logger.info('product_event', {
    event,
    ...props,
    ts: new Date().toISOString(),
  });

  // Fire-and-forget — never await this
  fireN8nWebhook('product-event', {
    event,
    ...props,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { logEvent };
```

---

## Emitting in src/routes/onboard.js

Add after `promptCompiler.compile(clientId)` succeeds and before `res.status(201)`:

```javascript
'use strict';

const { logEvent } = require('../utils/analytics');

// Inside router.post('/', ...) after conn.query('COMMIT') and compile:
logEvent('client_onboarded', {
  client_id: clientId,
  vertical: vertical || 'general',
  wallet_tier: wallet_tier || 'standard',
  has_fsm_integration: Boolean(integration && integration.credentials),
  business_phone: business_phone,
});

if (integration && integration.credentials) {
  logEvent('fsm_integration_configured', {
    client_id: clientId,
    platform: integration.platform,
    integration_type: integration.integration_type || 'fsm',
  });
}
```

---

## Emitting in src/routes/call.js

Add after the `call_logs` INSERT succeeds, checking if this is the first call:

```javascript
'use strict';

const { logEvent } = require('../utils/analytics');

// Inside router.post('/complete', ...) after pool.query INSERT:
const callCount = await pool.query(
  'SELECT COUNT(*) FROM call_logs WHERE client_id = $1',
  [client_id]
);

if (parseInt(callCount.rows[0].count) === 1) {
  logEvent('first_call_answered', {
    client_id,
    call_id,
    duration_seconds,
    outcome,
  });
}
```

---

## Activation Checklist Query

Run this to get activation status for all clients or a single client.
Connect via PgBouncer (`PGBOUNCER_URL`).

```sql
SELECT
  c.id                                          AS client_id,
  c.business_name,
  c.vertical,
  c.created_at                                  AS onboarded_at,
  w.balance_cents > 0                           AS wallet_funded,
  MIN(cl.created_at)                            AS first_call_at,
  MIN(b.created_at)                             AS first_booking_at,
  ci.is_active                                  AS fsm_configured
FROM clients c
LEFT JOIN wallets w              ON w.client_id = c.id
LEFT JOIN call_logs cl           ON cl.client_id = c.id
LEFT JOIN bookings b             ON b.client_id = c.id
LEFT JOIN client_integrations ci ON ci.client_id = c.id AND ci.is_active = true
GROUP BY c.id, c.business_name, c.vertical, c.created_at, w.balance_cents, ci.is_active
ORDER BY c.created_at DESC;
```

---

## DO / DON'T

DO — emit `logEvent()` calls in route handlers, after the primary database
write succeeds. This keeps side effects visible and auditable.

DON'T — call `logEvent()` inside `src/services/*.js`. Services have no
knowledge of the HTTP request context and mixing analytics into service
logic makes them harder to test and reuse.

```javascript
// WRONG — emitting from inside bookingService.js
async function createBooking(data) {
  // ... booking logic ...
  logEvent('first_booking_created', { client_id: data.client_id }); // side effect buried in service
}

// RIGHT — emit from src/routes/booking.js after createBooking() returns
const result = await bookingService.createBooking({ ... });
if (result.is_first_booking) {
  logEvent('first_booking_created', { client_id, call_id });
}
```

DON'T — await the n8n webhook call inside an Express route handler.
`fireN8nWebhook` is already fire-and-forget in `src/services/bookingService.js`.
Verify it does not block before wrapping it in `logEvent`.
