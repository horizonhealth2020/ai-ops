# Engagement & Adoption Tracking

Feature adoption tells you which platform capabilities clients are actually
using — and which ones are going unused. Track adoption by emitting events
at the route layer and computing per-tenant scores with a SQL query.

> WARNING: Never await analytics calls inside the SSE stream handler in
> `src/routes/vapi.js`. The `/api/v1/context/inject` endpoint streams tokens
> to Vapi in real time. Any blocking I/O inside the stream path will increase
> first-token latency and degrade call quality.

---

## Feature Adoption Events

| Event | When to Emit | Route / Service |
|---|---|---|
| `faq_search_used` | `faqSearch.search()` returns results | src/routes/vapi.js (after stream) |
| `caller_memory_hit` | `callerMemory.lookup()` finds history | src/routes/vapi.js (after stream) |
| `payment_link_sent` | Twilio SMS dispatched | src/routes/payment.js |
| `transfer_initiated` | Transfer config returned | src/routes/call.js |
| `booking_created` | `bookingService.createBooking()` succeeds | src/routes/booking.js |
| `wallet_depleted` | `balance_after_cents === 0` | src/routes/call.js |

---

## Emitting After the SSE Stream Completes

The `context/inject` endpoint in `src/routes/vapi.js` pipes tokens via SSE.
Attach adoption events to the `res.on('finish')` hook, not inline:

```javascript
'use strict';

const { logEvent } = require('../utils/analytics');

// Inside POST /api/v1/context/inject handler, after stream setup:
const faqResults = await faqSearch.search(clientId, lastUserMessage);
const callerHistory = await callerMemory.lookup(clientId, callerPhone);

// Track after the response ends — never inside the SSE write loop
res.on('finish', () => {
  if (faqResults && faqResults.length > 0) {
    logEvent('faq_search_used', {
      client_id: clientId,
      call_id: callId,
      result_count: faqResults.length,
    });
  }
  if (callerHistory && callerHistory.call_count > 0) {
    logEvent('caller_memory_hit', {
      client_id: clientId,
      call_id: callId,
      prior_calls: callerHistory.call_count,
    });
  }
});
```

---

## Emitting in src/routes/payment.js

```javascript
'use strict';

const { logEvent } = require('../utils/analytics');

// After Twilio SMS sends successfully:
logEvent('payment_link_sent', {
  client_id,
  call_id,
  processor: paymentResult.processor,   // 'stripe' | 'square'
  amount_cents: paymentResult.amount_cents,
});
```

---

## Per-Tenant Adoption Score Query

Returns a 0–5 score based on how many features each tenant has used.
Run this as a reporting query or scheduled n8n workflow.

```sql
SELECT
  c.id              AS client_id,
  c.business_name,
  c.vertical,
  (
    -- Feature 1: Has answered at least one call
    (CASE WHEN COUNT(DISTINCT cl.call_id) > 0 THEN 1 ELSE 0 END) +
    -- Feature 2: Has created at least one booking
    (CASE WHEN COUNT(DISTINCT b.id) > 0 THEN 1 ELSE 0 END) +
    -- Feature 3: Has sent at least one payment link
    (CASE WHEN COUNT(DISTINCT wt.id) FILTER (WHERE wt.type = 'usage') > 0 THEN 1 ELSE 0 END) +
    -- Feature 4: Has a funded wallet
    (CASE WHEN w.balance_cents > 0 THEN 1 ELSE 0 END) +
    -- Feature 5: Has active FSM integration
    (CASE WHEN ci.is_active IS TRUE THEN 1 ELSE 0 END)
  )                 AS adoption_score
FROM clients c
LEFT JOIN call_logs cl             ON cl.client_id = c.id
LEFT JOIN bookings b               ON b.client_id = c.id
LEFT JOIN wallets w                ON w.client_id = c.id
LEFT JOIN wallet_transactions wt   ON wt.client_id = c.id
LEFT JOIN client_integrations ci   ON ci.client_id = c.id AND ci.is_active = true
GROUP BY c.id, c.business_name, c.vertical, w.balance_cents, ci.is_active
ORDER BY adoption_score DESC;
```

---

## Wallet Depletion Engagement Trigger

When a client's balance reaches zero, fire an n8n re-engagement webhook.
Place this in `src/routes/call.js` after `deductCallCost()` returns.

```javascript
'use strict';

const { fireN8nWebhook } = require('../services/bookingService');
const logger = require('../utils/logger');

// After walletResult = await deductCallCost(...):
if (walletResult && walletResult.balance_after_cents === 0) {
  logger.warn('Wallet depleted', { client_id, call_id });

  // Fire-and-forget re-engagement webhook
  fireN8nWebhook('wallet-depleted', {
    client_id,
    call_id,
    depleted_at: new Date().toISOString(),
  });
}
```

---

## DO / DON'T

DO — emit feature adoption events fire-and-forget after the primary
response has been sent or after `res.on('finish')`.

DON'T — block SSE token delivery with analytics writes. The call path
latency budget for `/api/v1/context/inject` is tight.

```javascript
// WRONG — awaiting inside SSE write loop
for await (const chunk of openaiStream) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  await logEvent('token_streamed', { ... }); // blocks every token
}

// RIGHT — defer to finish hook
res.on('finish', () => {
  logEvent('faq_search_used', { client_id, result_count });
});
```

DON'T — track at the service layer. `src/services/faqSearch.js` and
`src/services/callerMemory.js` are reused across contexts. Side effects
belong at the route layer where request context is available.
