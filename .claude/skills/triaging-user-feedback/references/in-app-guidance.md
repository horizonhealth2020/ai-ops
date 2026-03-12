# In-App Guidance Reference

## Contents
- Where guidance surfaces live
- Wallet depletion warning
- Booking flow error messages
- Dashboard empty states
- DO/DON'T pairs

## Where Guidance Surfaces Live

This is a backend API — there is no React frontend in this repo. In-app guidance surfaces through:
1. **Agent responses** — the Vapi AI agent's spoken words (controlled by `system_prompt`)
2. **Dashboard API responses** — JSON payloads consumed by a client-side dashboard
3. **Error response bodies** — structured errors returned to callers and dashboard clients

All three are owned by this backend and must be treated as guidance surfaces.

## Wallet Depletion Warning

When `balance_cents = 0`, the agent switches to message-only mode. The transition message is part of `system_prompt` — clients must be warned before hitting zero.

```javascript
// src/services/walletService.js — add low-balance warning to context
async function getWalletContext(clientId) {
  const { rows } = await pool.query(
    'SELECT balance_cents, tier FROM client_wallets WHERE client_id = $1',
    [clientId]
  );
  const { balance_cents, tier } = rows[0];
  const LOW_BALANCE_THRESHOLD_CENTS = 500; // $5.00

  return {
    balance_cents,
    is_low: balance_cents < LOW_BALANCE_THRESHOLD_CENTS,
    warning: balance_cents < LOW_BALANCE_THRESHOLD_CENTS
      ? 'Wallet balance is low. Reload to keep your agent active.'
      : null,
  };
}
```

**Feedback signal:** If clients complain "agent went silent with no warning," the guidance is missing. This is a quick win — inject `warning` into the dashboard `GET /api/v1/dashboard/wallet` response.

## Booking Flow Error Messages

The booking flow has three failure points. Each must return a guidance-bearing message, not a raw error.

```javascript
// src/routes/booking.js — guidance-bearing error responses
router.post('/create', async (req, res, next) => {
  try {
    const result = await bookingService.createBooking(req.body);
    res.json(result);
  } catch (err) {
    if (err.code === 'SLOT_TAKEN') {
      return res.status(409).json({
        error: 'slot_unavailable',
        message: 'That time was just taken. Here are the next available slots.',
        alternatives: err.alternatives,  // Must be populated by bookingService
      });
    }
    if (err.code === 'FSM_REJECTED') {
      return res.status(422).json({
        error: 'fsm_rejected',
        message: 'The booking could not be confirmed with your scheduling system. Please try another time.',
      });
    }
    next(err);
  }
});
```

## Dashboard Empty States

`GET /api/v1/dashboard/calls` with no results is an empty state that needs guidance, not just `[]`.

```javascript
// src/routes/dashboard.js — enrich empty call log response
const { rows } = await pool.query(callLogQuery, params);
if (rows.length === 0) {
  return res.json({
    calls: [],
    empty_state: {
      message: 'No calls yet. Make sure your Vapi assistant is pointed at this server.',
      docs_url: 'https://docs.vapi.ai/custom-llm',
    },
  });
}
```

## DO/DON'T Pairs

**DO** return structured error bodies with `message` fields the dashboard can surface to clients. Raw stack traces are never acceptable in production responses.

**DON'T** put guidance only in the spoken agent response — clients checking the dashboard after a failed call need to see what went wrong.

```javascript
// GOOD — structured, actionable error
res.status(402).json({
  error: 'insufficient_balance',
  message: 'Your wallet balance is $0. Reload at least $10 to re-enable bookings.',
  reload_url: '/dashboard/wallet',
});

// BAD — raw error leaks internals
res.status(500).json({ error: err.message });
```

**DO** include `alternatives` arrays in slot-unavailable responses — the agent needs them to keep the conversation going.

See the **crafting-empty-states** skill for copy patterns on empty state messages.
