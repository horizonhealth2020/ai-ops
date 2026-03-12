# Activation & Onboarding Reference

## Contents
- Onboarding entry point
- Activation checklist pattern
- Wallet funding gate
- Vapi configuration gate
- Anti-patterns

---

## Onboarding Entry Point

New clients enter via `POST /api/v1/onboard`. After creation, the dashboard's first `GET /api/v1/dashboard/config` call should return an `onboarding_state` object so the client can render a setup checklist.

```javascript
// src/routes/onboard.js — after inserting client row
router.post('/', async (req, res, next) => {
  try {
    const clientId = uuidv4();
    await pool.query(
      `INSERT INTO clients (client_id, business_name, phone_number, vertical, tier)
       VALUES ($1, $2, $3, $4, 'standard')`,
      [clientId, businessName, phoneNumber, vertical]
    );

    // Fire async n8n webhook for post-onboard workflow
    if (process.env.N8N_WEBHOOK_BASE_URL) {
      await axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/onboard`, {
        client_id: clientId,
        business_name: businessName
      }).catch(err => logger.warn('n8n onboard webhook failed', { err: err.message }));
    }

    logger.info('Client onboarded', { client_id: clientId });
    res.status(201).json({ client_id: clientId, onboarding_started: true });
  } catch (err) {
    next(err);
  }
});
```

## Activation Checklist Pattern

Surface the checklist on every `GET /api/v1/dashboard/config` response until `is_complete` is true. Once complete, omit the field to reduce payload size.

```javascript
// src/routes/dashboard.js
async function buildOnboardingState(clientId, config, pool) {
  const [integrationsResult, walletResult] = await Promise.all([
    pool.query('SELECT integration_type FROM client_integrations WHERE client_id = $1', [clientId]),
    pool.query('SELECT balance_cents FROM client_wallets WHERE client_id = $1', [clientId])
  ]);

  const steps = [
    {
      key: 'agent_configured',
      complete: !!(config.agent_name && config.system_prompt),
      label: 'Configure your AI agent'
    },
    {
      key: 'business_hours_set',
      complete: !!config.business_hours,
      label: 'Set business hours'
    },
    {
      key: 'fsm_connected',
      complete: integrationsResult.rows.some(r => r.integration_type === 'fsm'),
      label: 'Connect your field service management tool'
    },
    {
      key: 'wallet_funded',
      complete: (walletResult.rows[0]?.balance_cents ?? 0) > 0,
      label: 'Add wallet funds to enable call handling'
    }
  ];

  const completedCount = steps.filter(s => s.complete).length;
  if (completedCount === steps.length) return null; // suppress when done

  return {
    steps,
    percent_complete: Math.round((completedCount / steps.length) * 100)
  };
}
```

## Wallet Funding Gate

A $0 wallet is a critical empty state — the agent silently degrades to message-only mode. Expose this explicitly in the wallet endpoint.

```javascript
// src/routes/dashboard.js
router.get('/wallet', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.clerk;
    const wallet = await walletService.getBalance(clientId);

    res.json({
      balance_cents: wallet.balance_cents,
      tier: wallet.tier,
      transactions: wallet.recent_transactions,
      empty_state: wallet.balance_cents === 0 ? {
        reason: 'zero_balance',
        severity: 'critical',
        message: 'Your agent is in message-only mode. Calls are answered but bookings and payments are disabled.',
        action: 'add_funds'
      } : null
    });
  } catch (err) {
    next(err);
  }
});
```

## Vapi Configuration Gate

If the client has no `system_prompt` compiled yet, context injection will fail silently. Surface this before they go live.

```javascript
// Attach to GET /api/v1/dashboard/config response
function getVapiReadinessState(config) {
  if (config.system_prompt) return null;

  return {
    reason: 'no_system_prompt',
    message: 'Your agent prompt has not been compiled. Save your agent configuration to generate it.',
    action: 'configure_agent',
    severity: 'warning'
  };
}
```

## Anti-Patterns

### WARNING: Silent empty arrays

**The Problem:**
```javascript
// BAD - client has no way to distinguish "no calls yet" from an error
res.json({ calls: [] });
```

**Why This Breaks:**
1. Dashboard renders a generic empty state with no actionable guidance
2. Can't distinguish "no calls because Vapi isn't configured" from "no calls this week"
3. Activation funnel breaks — you can't track which step a client is stuck on

**The Fix:**
```javascript
// GOOD - reason code enables targeted guidance
res.json({
  calls: [],
  empty_state: { reason: 'no_calls_yet', action: 'configure_vapi' }
});
```

### WARNING: Onboarding state computed on every request

NEVER re-run the full checklist query on every dashboard request in a hot path. Cache the `onboarding_state` in the `client_config:{client_id}` Redis key alongside the config. Invalidate when the client updates agent, hours, or integrations.

See the **redis** skill for cache invalidation patterns.
