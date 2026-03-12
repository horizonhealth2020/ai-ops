# In-App Guidance Flags

Guidance flags are server-derived booleans injected into the
`GET /api/v1/dashboard/config` response. The dashboard frontend reads them
to show setup prompts, empty states, and contextual hints — without any
client-side logic or separate API calls.

---

## Guidance Flag Definitions

| Flag | True When | Action for Dashboard |
|---|---|---|
| `wallet_empty` | `wallets.balance_cents = 0` | Show "Add funds" CTA |
| `no_fsm_configured` | No active `client_integrations` row | Show "Connect your FSM" setup step |
| `no_calls_yet` | Zero rows in `call_logs` for client | Show "Your phone agent is ready" empty state |
| `first_booking_pending` | `bookings` row with `status = 'pending'` exists | Show "Review your first booking" banner |

---

## SQL Query to Derive Guidance Flags

Run a single query in `src/routes/dashboard.js` alongside the existing
`loadClientFromDb()` call. Both resolve in parallel.

```javascript
'use strict';

const pool = require('../config/database');

async function getGuidanceFlags(clientId) {
  const result = await pool.query(
    `SELECT
       w.balance_cents = 0                                       AS wallet_empty,
       NOT EXISTS (
         SELECT 1 FROM client_integrations ci
         WHERE ci.client_id = $1 AND ci.is_active = true
       )                                                         AS no_fsm_configured,
       NOT EXISTS (
         SELECT 1 FROM call_logs cl
         WHERE cl.client_id = $1
       )                                                         AS no_calls_yet,
       EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.client_id = $1 AND b.status = 'pending'
       )                                                         AS first_booking_pending
     FROM wallets w
     WHERE w.client_id = $1`,
    [clientId]
  );

  // Default all flags to false if wallet row doesn't exist yet
  return result.rows[0] || {
    wallet_empty: true,
    no_fsm_configured: true,
    no_calls_yet: true,
    first_booking_pending: false,
  };
}

module.exports = { getGuidanceFlags };
```

---

## Enriching the Dashboard Config Response (src/routes/dashboard.js)

Extend `GET /api/v1/dashboard/config` to include `guidance_flags`.
Resolve both queries in parallel to keep response time low.

```javascript
'use strict';

const { loadClientFromDb } = require('../middleware/tenantResolver');
const { getGuidanceFlags } = require('../utils/guidanceFlags');

router.get('/config', async (req, res, next) => {
  try {
    const [client, guidanceFlags] = await Promise.all([
      loadClientFromDb(req.clientId),
      getGuidanceFlags(req.clientId),
    ]);

    if (!client) return res.status(404).json({ error: 'Client not found' });

    res.json({
      business_name: client.business_name,
      business_phone: client.business_phone,
      vertical: client.vertical,
      timezone: client.timezone,
      // ... other fields ...
      guidance_flags: guidanceFlags,
    });
  } catch (err) {
    next(err);
  }
});
```

---

## Empty State Response Shape

When a new client has zero calls and no FSM connected, the dashboard
config response looks like:

```json
{
  "business_name": "Apex Plumbing & HVAC",
  "business_phone": "+19545550100",
  "vertical": "hvac",
  "guidance_flags": {
    "wallet_empty": true,
    "no_fsm_configured": true,
    "no_calls_yet": true,
    "first_booking_pending": false
  }
}
```

The dashboard frontend maps each flag to a UI component — e.g., a setup
checklist card — without parsing business logic itself.

---

## DO / DON'T

DO — derive guidance flags server-side in `src/routes/dashboard.js`.
The query is cheap (indexed on `client_id`) and runs in parallel with
the main config fetch.

DON'T — add guidance flag logic to `src/services/promptBuilder.js` or
`src/services/promptCompiler.js`. The call path must stay fast — prompt
compilation runs during live calls and has a strict latency budget.

```javascript
// WRONG — guidance logic leaking into promptBuilder
function buildPrompt(client, callerContext) {
  if (client.wallet_balance === 0) {
    // Do NOT add setup guidance to the voice agent's system prompt
    return basePrompt + '\n\nRemind caller to reload wallet.';
  }
}

// RIGHT — guidance flags belong in the dashboard route, not the call path
router.get('/config', async (req, res, next) => {
  const guidanceFlags = await getGuidanceFlags(req.clientId);
  res.json({ ...clientData, guidance_flags: guidanceFlags });
});
```

DON'T — use guidance flags to gate API functionality. They are read-only
hints for the dashboard UI. Access control belongs in `src/middleware/auth.js`.

---

## Related Skills

See **crafting-empty-states** skill for UI copy paired with these flags.
See **designing-onboarding-paths** skill for sequencing the setup checklist.
See **orchestrating-feature-adoption** skill for timing nudges based on flag state.
