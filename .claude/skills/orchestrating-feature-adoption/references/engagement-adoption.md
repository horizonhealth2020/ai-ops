# Engagement & Adoption Reference

## Contents
- Adoption Signal Sources
- Tier-Based Feature Unlocks
- Returning Caller Feature
- WARNING: Feature Flags in Code vs Database
- FSM Integration Adoption

---

## Adoption Signal Sources

Feature adoption in this backend is measured by what clients have configured and used, not by UI clicks. The key adoption signals are:

| Signal | Table/Column | Meaning |
|--------|-------------|---------|
| Has FSM integration | `client_integrations.is_active` | Using booking automation |
| Has funded wallet | `wallets.balance_cents > 0` | Ready to receive paid calls |
| Call volume | `call_logs` row count per `client_id` | Agent actively answering calls |
| Booking rate | `bookings` rows vs `call_logs` rows | Agent converting callers |
| Payment intents | `payment_intents` table | Using payment collection |
| pgvector FAQs | `client_faqs` rows | Using semantic FAQ search |

Query adoption cohorts with:

```sql
-- Which clients are using bookings but NOT payments?
SELECT c.client_id, c.business_name, c.vertical,
       COUNT(DISTINCT b.booking_id) AS bookings,
       COUNT(DISTINCT pi.intent_id) AS payment_intents
FROM clients c
LEFT JOIN bookings b ON b.client_id = c.client_id
LEFT JOIN payment_intents pi ON pi.client_id = c.client_id
WHERE c.is_active = true
GROUP BY c.client_id, c.business_name, c.vertical
HAVING COUNT(DISTINCT b.booking_id) > 0 AND COUNT(DISTINCT pi.intent_id) = 0;
```

## Tier-Based Feature Unlocks

Clients on higher wallet tiers unlock features. Map tier to capability in the service layer, not in the route handler.

```javascript
// src/services/featureService.js
'use strict';

const TIER_FEATURES = {
  standard: ['booking', 'faq_search', 'caller_memory'],
  growth:   ['booking', 'faq_search', 'caller_memory', 'payment_links', 'sms_notifications'],
  scale:    ['booking', 'faq_search', 'caller_memory', 'payment_links', 'sms_notifications', 'fsm_sync'],
  enterprise: ['booking', 'faq_search', 'caller_memory', 'payment_links', 'sms_notifications', 'fsm_sync', 'priority_routing'],
};

function hasFeature(tier, feature) {
  return (TIER_FEATURES[tier] || TIER_FEATURES.standard).includes(feature);
}

module.exports = { hasFeature };
```

Use it before expensive operations:

```javascript
// src/routes/payment.js
const { hasFeature } = require('../services/featureService');

router.post('/create-intent', requireVapi, async (req, res, next) => {
  try {
    const { tier } = await walletService.getBalance(req.tenant.clientId);
    if (!hasFeature(tier, 'payment_links')) {
      return res.status(403).json({
        error: 'Payment links require Growth tier or above',
        upgrade_action: 'upgrade_tier',
      });
    }
    // ... proceed with payment intent creation
  } catch (err) {
    next(err);
  }
});
```

## Returning Caller Feature Adoption

The returning caller recognition feature (`src/services/callerMemory.js`) is a high-value differentiator. Track whether clients have enough call history for it to work:

```javascript
// src/services/callerMemory.js
async function getCallerHistory(clientId, callerPhone) {
  const result = await pool.query(
    `SELECT call_id, started_at, duration_seconds, outcome, summary
     FROM call_logs
     WHERE client_id = $1 AND caller_phone = $2
     ORDER BY started_at DESC
     LIMIT 5`,
    [clientId, callerPhone]
  );

  if (result.rows.length === 0) {
    return { is_returning: false, history: [] };
  }

  return {
    is_returning: true,
    call_count: result.rows.length,
    last_call: result.rows[0].started_at,
    history: result.rows,
  };
}
```

### WARNING: Feature Flags in Code vs Database

**The Problem:**

```javascript
// BAD — feature flags hardcoded in source
const PAYMENT_ENABLED_CLIENTS = ['uuid-1', 'uuid-2', 'uuid-3'];
if (PAYMENT_ENABLED_CLIENTS.includes(clientId)) { ... }
```

**Why This Breaks:**
1. Enabling a feature for a new client requires a code deploy — unacceptable for a SaaS platform
2. The list diverges from reality as clients churn or upgrade
3. No audit trail for when a flag was set or by whom

**The Fix:**
Store feature flags in `clients.feature_flags` JSONB column. Update per-client without deploys:

```javascript
// GOOD — feature flags from database
const result = await pool.query(
  'SELECT feature_flags FROM clients WHERE client_id = $1',
  [clientId]
);
const flags = result.rows[0]?.feature_flags || {};
if (flags.payment_links) { ... }
```

Enable a flag for a client:
```sql
UPDATE clients
SET feature_flags = feature_flags || '{"payment_links": true}'::jsonb
WHERE client_id = 'target-uuid';
```

## FSM Integration Adoption

Clients who connect an FSM integration (HouseCall Pro, Jobber, ServiceTitan) have significantly higher retention — the booking automation is core value. Detect and nudge the gap:

```javascript
// src/services/activationService.js — check FSM adoption at config load time
async function getFsmAdoptionState(clientId) {
  const result = await pool.query(
    `SELECT integration_type, is_active, created_at
     FROM client_integrations
     WHERE client_id = $1 AND integration_type = 'fsm'`,
    [clientId]
  );

  if (result.rows.length === 0) {
    return { connected: false, nudge: { action: 'connect_fsm', priority: 'high' } };
  }

  const active = result.rows.find(r => r.is_active);
  return {
    connected: Boolean(active),
    fsm_type: active?.integration_type,
    nudge: active ? null : { action: 'reactivate_fsm', priority: 'medium' },
  };
}
```

See the **designing-onboarding-paths** skill for the full onboarding flow that leads to FSM connection.
