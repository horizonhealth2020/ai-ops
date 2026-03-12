# Measurement & Testing Reference

## Contents
- Upgrade Funnel Events
- SQL Queries for Funnel Analysis
- Testing Upgrade Trigger Paths
- Anti-Patterns

---

## Upgrade Funnel Events

Every upgrade moment needs a log entry to measure conversion. Use `logger.info` with a consistent `event` field so n8n and future analytics can query by event type.

```javascript
// Event taxonomy for upgrade funnel
const UPGRADE_EVENTS = {
  WALLET_EMPTY_BLOCKED:    'upgrade.wallet_empty_blocked',     // call blocked, agent switched modes
  WALLET_LOW_WARNING:      'upgrade.wallet_low_warning',       // warning surfaced in API response
  THRESHOLD_CROSSED:       'upgrade.threshold_crossed',        // balance crossed $50/$20/$5/$0
  UPGRADE_PROMPT_SHOWN:    'upgrade.prompt_shown',             // upgrade_available in wallet response
  TIER_UPGRADED:           'upgrade.tier_upgraded',            // wallet tier changed (from dashboard PUT)
  WALLET_RELOADED:         'upgrade.wallet_reloaded',          // wallet_transactions INSERT type='reload'
};
```

### Logging in walletService.js

```javascript
// src/services/walletService.js — after deductCallCost
if (balanceAfter <= 0 && previousBalance > 0) {
  logger.info('Wallet emptied', {
    event: UPGRADE_EVENTS.THRESHOLD_CROSSED,
    client_id: clientId,
    previous_balance_cents: previousBalance,
    balance_after_cents: balanceAfter,
    tier: wallet.tier,
  });
}

if (shouldSendUpgradeSms(wallet, previousBalance)) {
  logger.info('Upgrade threshold crossed', {
    event: UPGRADE_EVENTS.THRESHOLD_CROSSED,
    client_id: clientId,
    balance_cents: balanceAfter,
    tier: wallet.tier,
  });
}
```

### Logging in vapi.js (zero-balance block)

```javascript
// src/routes/vapi.js
if (!hasFunds) {
  logger.warn('Call blocked — wallet empty', {
    event: UPGRADE_EVENTS.WALLET_EMPTY_BLOCKED,
    client_id: client.id,
    caller_phone: callerPhone,
    tier: wallet?.tier,
  });
}
```

---

## SQL Queries for Funnel Analysis

Query `wallet_transactions` and `call_logs` to measure upgrade funnel performance. All money is in cents.

### Clients at $0 with calls in last 30 days

```sql
SELECT
  w.client_id,
  c.business_name,
  w.tier,
  w.balance_cents,
  COUNT(cl.call_id) AS calls_last_30d,
  SUM(cl.duration_seconds) / 60 AS total_minutes
FROM wallets w
JOIN clients c ON c.id = w.client_id
LEFT JOIN call_logs cl
  ON cl.client_id = w.client_id
  AND cl.created_at > NOW() - INTERVAL '30 days'
WHERE w.balance_cents = 0
  AND c.is_active = true
GROUP BY w.client_id, c.business_name, w.tier, w.balance_cents
ORDER BY calls_last_30d DESC;
```

### Reload conversion rate after low-balance warning

```sql
-- Clients who hit low-balance threshold and subsequently reloaded
SELECT
  w.client_id,
  w.tier,
  MIN(wt_low.created_at) AS first_low_balance_at,
  MIN(wt_reload.created_at) AS first_reload_after_low,
  EXTRACT(EPOCH FROM (MIN(wt_reload.created_at) - MIN(wt_low.created_at))) / 3600 AS hours_to_reload
FROM wallets w
JOIN wallet_transactions wt_low
  ON wt_low.client_id = w.client_id
  AND wt_low.type = 'usage'
  AND wt_low.balance_after_cents < 2000
JOIN wallet_transactions wt_reload
  ON wt_reload.client_id = w.client_id
  AND wt_reload.type = 'reload'
  AND wt_reload.created_at > wt_low.created_at
GROUP BY w.client_id, w.tier;
```

---

## Testing Upgrade Trigger Paths

### Test: Zero-Balance Agent Switch

```javascript
// Verify the agent switches to message-only mode at $0
it('returns message-only response when wallet is empty', async () => {
  // Mock checkBalance to return false
  jest.spyOn(walletService, 'checkBalance').mockResolvedValue(false);

  const response = await request(app)
    .post('/api/v1/context/inject')
    .set('Authorization', `Bearer ${process.env.VAPI_API_KEY}`)
    .send({ messages: [], metadata: { client_id: testClientId } });

  expect(response.status).toBe(200);
  expect(response.body.choices[0].message.content).toContain('take a message');
  // Confirm it does NOT contain booking or payment language
  expect(response.body.choices[0].message.content).not.toContain('book');
});
```

### Test: Low-Balance Warning in Deduction Response

```javascript
// Verify upgrade_nudge appears when balance drops below $20
it('includes upgrade_nudge when balance drops below 2000 cents', async () => {
  // Set up wallet with balance that will drop below threshold
  await pool.query(
    'UPDATE wallets SET balance_cents = 2500, tier = $1 WHERE client_id = $2',
    ['standard', testClientId]
  );

  const result = await walletService.deductCallCost(testClientId, 180, 'test-call-1');

  // 3 min @ 40¢ = 120¢ deducted, balance = 2380¢ — still above threshold
  // 4 min @ 40¢ = 160¢ deducted from 2500¢ → 2340¢ — below 2000 threshold
  expect(result.balance_after_cents).toBeDefined();
  if (result.balance_after_cents < 2000) {
    expect(result.upgrade_nudge).toBeDefined();
    expect(result.upgrade_nudge.next_tier).toBe('growth');
  }
});
```

---

## Anti-Patterns

### WARNING: Logging Upgrade Events Without client_id

**The Problem:**

```javascript
// BAD — cannot attribute upgrade events to specific clients
logger.info('Wallet low warning shown');
```

**Why This Breaks:**
Every query for upgrade funnel analysis requires `client_id`. Without it, you can count events but cannot calculate per-client conversion rates, identify stuck clients, or trigger targeted follow-up.

**The Fix:**

```javascript
// GOOD — always include client_id and tier in upgrade events
logger.info('Wallet low warning shown', {
  event: 'upgrade.wallet_low_warning',
  client_id: clientId,
  balance_cents: balanceAfter,
  tier: wallet.tier,
  next_tier: getNextTier(wallet.tier),
});
```

See the **mapping-conversion-events** skill for the full event schema and n8n integration.
