# In-App Guidance Reference

## Contents
- Guidance as API response fields
- Empty state structure
- Onboarding checklist endpoint
- Blocking vs informational guidance
- Anti-patterns

---

## Guidance as API Response Fields

This is a server-rendered API — there is no frontend framework. "In-app guidance" means JSON fields in dashboard API responses that the client-side app renders. Every guidance block follows the same shape:

```javascript
// Standard guidance block shape — use consistently across all dashboard routes
{
  type: 'string',           // 'empty_state' | 'nudge' | 'blocker'
  severity: 'string',       // 'info' | 'warning' | 'blocking'
  heading: 'string',        // Short title
  message: 'string',        // Explanation for the user
  cta: {
    label: 'string',        // Button text
    action: 'string',       // Frontend action identifier
  }
}
```

Never return `null` or an empty object for guidance — omit the field entirely if there's nothing to show.

---

## Empty State Structure

Every list endpoint (`/calls`, `/wallet`, bookings) must return an `empty_state` when the list is empty. The client app shows this instead of an empty table.

```javascript
// src/routes/dashboard.js — GET /api/v1/dashboard/calls
const { rows: calls } = await pool.query(
  'SELECT * FROM call_logs WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
  [clientId, limit, offset]
);

if (calls.length === 0 && offset === 0) {
  return res.json({
    calls: [],
    total: 0,
    empty_state: {
      type: 'empty_state',
      severity: 'info',
      heading: 'No calls yet',
      message: 'Your AI agent will log calls here once it starts handling inbound calls.',
      cta: { label: 'Test your agent', action: 'open_vapi_test' },
    },
  });
}
```

---

## Onboarding Checklist Endpoint

Add a dedicated `GET /api/v1/dashboard/setup` endpoint that returns a structured checklist. This gives dashboards a single source of truth for setup progress without polluting the config endpoint.

```javascript
// src/routes/dashboard.js
router.get('/setup', requireClerkAuth, async (req, res, next) => {
  try {
    const clientId = req.auth.clientId;

    const [client, wallet, fsm, faqs] = await Promise.all([
      pool.query('SELECT onboarding_step, vapi_assistant_id FROM clients WHERE client_id = $1', [clientId]),
      pool.query('SELECT balance_cents FROM wallets WHERE client_id = $1', [clientId]),
      pool.query("SELECT 1 FROM client_integrations WHERE client_id = $1 AND integration_type = 'fsm' LIMIT 1", [clientId]),
      pool.query('SELECT COUNT(*) FROM client_faqs WHERE client_id = $1', [clientId]),
    ]);

    const c = client.rows[0];
    const w = wallet.rows[0];

    res.json({
      steps: [
        {
          id: 'fund_wallet',
          label: 'Fund your wallet',
          completed: w.balance_cents > 0,
          cta: w.balance_cents > 0 ? null : { label: 'Add funds', action: 'open_wallet_topup' },
        },
        {
          id: 'connect_fsm',
          label: 'Connect scheduling software',
          completed: fsm.rows.length > 0,
          cta: fsm.rows.length > 0 ? null : { label: 'Connect FSM', action: 'open_fsm_setup' },
        },
        {
          id: 'configure_vapi',
          label: 'Configure AI agent',
          completed: !!c.vapi_assistant_id,
          cta: c.vapi_assistant_id ? null : { label: 'Configure agent', action: 'open_agent_config' },
        },
        {
          id: 'add_faqs',
          label: 'Add FAQs',
          completed: parseInt(faqs.rows[0].count, 10) > 0,
          cta: parseInt(faqs.rows[0].count, 10) > 0 ? null : { label: 'Add FAQs', action: 'open_faq_editor' },
        },
      ],
      is_complete: c.onboarding_step === 'active',
    });
  } catch (err) {
    next(err);
  }
});
```

---

## Blocking vs Informational Guidance

Use `severity: 'blocking'` only when the agent is non-functional. The client dashboard must gate usage behind this:

| Condition | Severity | Example message |
|-----------|----------|-----------------|
| `balance_cents === 0` | `blocking` | "Agent is in message-only mode. Fund wallet to re-enable." |
| `onboarding_step !== 'active'` | `blocking` | "Complete setup before your agent can handle calls." |
| `balance_cents < 1000` | `warning` | "Low balance — top up to avoid interruptions." |
| No FAQs after 5+ calls | `info` | "Add FAQs to improve agent accuracy." |

```javascript
// src/services/walletService.js
function getWalletGuidance(balanceCents) {
  if (balanceCents === 0) {
    return {
      type: 'blocker',
      severity: 'blocking',
      heading: 'Agent offline',
      message: 'Your wallet is empty. Fund it to restore full agent capabilities.',
      cta: { label: 'Add funds', action: 'open_wallet_topup' },
    };
  }
  if (balanceCents < 1000) {
    return {
      type: 'nudge',
      severity: 'warning',
      heading: 'Low balance',
      message: `$${(balanceCents / 100).toFixed(2)} remaining. Top up before your next busy period.`,
      cta: { label: 'Top up', action: 'open_wallet_topup' },
    };
  }
  return null;
}
```

---

### WARNING: Returning Guidance Inside Error Responses

**The Problem:**

```javascript
// BAD — mixing guidance into 4xx/5xx responses
res.status(402).json({ error: 'Insufficient funds', guidance: { ... } });
```

**Why This Breaks:**
1. Client app error handlers typically only read `error` — guidance is silently dropped
2. HTTP 4xx means "client error", not "here's what to do next"
3. Logging and monitoring treat 4xx as errors, not guidance events

**The Fix:**

```javascript
// GOOD — guidance lives in 200 responses on dashboard routes only
// Vapi routes return clean errors; dashboard routes return guidance + data
res.json({ wallet: walletData, guidance: getWalletGuidance(balanceCents) });
```

See the **express** skill for error handler patterns that keep error responses clean.
