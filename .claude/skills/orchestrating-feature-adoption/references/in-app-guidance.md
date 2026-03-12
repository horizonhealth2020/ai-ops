# In-App Guidance Reference

## Contents
- Guidance as API Response Fields
- Nudge Schema Convention
- Wallet Soft-Lock Guidance
- WARNING: Guidance Logic in Routes
- Context-Aware Agent Guidance

---

## Guidance as API Response Fields

There is no frontend in this repo — in-app guidance surfaces as structured JSON fields in dashboard API responses. The client dashboard (external) reads these fields and renders guidance UI. Every guidance payload follows the same shape so the dashboard can handle it generically.

```javascript
// Standard nudge shape — include in any dashboard response where guidance is relevant
{
  nudge: {
    type: 'low_balance' | 'empty_state' | 'feature_discovery' | 'upgrade_prompt' | null,
    priority: 'high' | 'medium' | 'low',
    message: 'Human-readable message for the dashboard to display',
    action: 'fund_wallet' | 'connect_fsm' | 'configure_vapi' | 'upgrade_tier' | 'test_call' | null,
    metadata: {}  // optional, action-specific data
  }
}
```

Always set `nudge: null` when no guidance applies — never omit the field. A missing `nudge` key forces the dashboard to add null checks everywhere.

## Nudge Schema Convention

Centralize nudge construction in a utility to keep the shape consistent:

```javascript
// src/utils/nudgeBuilder.js
'use strict';

function buildNudge(type, priority, message, action, metadata = {}) {
  return { type, priority, message, action, metadata };
}

const NUDGES = {
  lowBalance: (balanceCents) => buildNudge(
    'low_balance', 'high',
    `Wallet balance is $${(balanceCents / 100).toFixed(2)}. Add funds to keep your agent active.`,
    'fund_wallet',
    { balance_cents: balanceCents }
  ),
  noFsm: () => buildNudge(
    'feature_discovery', 'high',
    'Connect a field service app to enable automated booking.',
    'connect_fsm'
  ),
  noVapi: () => buildNudge(
    'feature_discovery', 'medium',
    'Create your Vapi assistant to start answering calls.',
    'configure_vapi'
  ),
  noFaqs: (vertical) => buildNudge(
    'feature_discovery', 'low',
    `Add FAQs so your agent can answer common ${vertical} questions.`,
    'add_faqs'
  ),
};

module.exports = { NUDGES };
```

Use it in route handlers:

```javascript
// src/routes/dashboard.js
const { NUDGES } = require('../utils/nudgeBuilder');

router.get('/wallet', requireClerk, async (req, res, next) => {
  try {
    const wallet = await walletService.getBalance(req.tenant.clientId);
    const nudge = wallet.balance_cents < 500 ? NUDGES.lowBalance(wallet.balance_cents) : null;
    res.json({ ...wallet, nudge });
  } catch (err) {
    next(err);
  }
});
```

## Wallet Soft-Lock Guidance

When wallet hits zero, the agent switches to message-only mode. The guidance must tell the client exactly what happened and how to unblock.

```javascript
// src/services/walletService.js — check and return guidance context
async function checkCallPermission(clientId) {
  const result = await pool.query(
    'SELECT balance_cents, tier FROM wallets WHERE client_id = $1',
    [clientId]
  );
  const wallet = result.rows[0];

  if (!wallet || wallet.balance_cents <= 0) {
    return {
      allowed: false,
      mode: 'message_only',
      nudge: NUDGES.lowBalance(wallet?.balance_cents ?? 0),
    };
  }

  return { allowed: true, mode: 'full', nudge: null };
}
```

The Vapi route reads this and injects the constraint into the system prompt:

```javascript
// src/routes/vapi.js — inject wallet constraint into context
const permission = await walletService.checkCallPermission(clientId);
if (!permission.allowed) {
  systemPrompt += '\n\nIMPORTANT: You are in message-only mode. Do not attempt to book appointments or process payments. Inform the caller that the service is temporarily limited and ask them to try again later.';
}
```

### WARNING: Guidance Logic in Routes

**The Problem:**

```javascript
// BAD — nudge logic scattered across route handlers
router.get('/config', requireClerk, async (req, res, next) => {
  const wallet = await pool.query('SELECT balance_cents FROM wallets WHERE ...');
  const nudge = wallet.rows[0].balance_cents < 500
    ? { type: 'low_balance', message: 'Low balance!' }
    : null;
  // ... duplicated in /calls, /wallet, and /bookings routes
});
```

**Why This Breaks:**
1. The nudge threshold (500 cents) gets duplicated — change it in one place, miss it in three others
2. Route handlers become responsible for business logic, making them hard to test
3. Inconsistent nudge shapes between routes break the dashboard's generic handler

**The Fix:**
Centralize all nudge construction in `src/utils/nudgeBuilder.js`. Routes call the builder; they don't construct nudge objects inline.

## Context-Aware Agent Guidance via pgvector

When a client has uploaded FAQs, the `faqSearch` service enriches the agent's context. Surfacing FAQ completeness in the dashboard guides clients to add more:

```javascript
// src/routes/dashboard.js — config endpoint includes FAQ adoption signal
const faqCount = await pool.query(
  'SELECT COUNT(*) FROM client_faqs WHERE client_id = $1',
  [clientId]
);

const faqNudge = parseInt(faqCount.rows[0].count, 10) < 5
  ? NUDGES.noFaqs(client.vertical)
  : null;

res.json({ ...config, faq_count: parseInt(faqCount.rows[0].count, 10), nudge: faqNudge });
```

See the **pgvector** skill for FAQ embedding and search patterns.
