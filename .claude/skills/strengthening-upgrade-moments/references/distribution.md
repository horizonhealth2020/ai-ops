# Distribution Reference

## Contents
- Upgrade Notification Channels
- n8n Webhook Payloads
- Twilio SMS Patterns
- Channel Selection Logic

---

## Upgrade Notification Channels

The upgrade moment happens *after* the wallet event, through async channels. The Express routes handle the real-time call; n8n and Twilio handle operator notification.

| Event | Channel | File | Trigger |
|-------|---------|------|---------|
| Wallet hits $0 | n8n webhook → email/SMS | `src/routes/vapi.js` | `checkBalance()` false |
| Balance < $20 post-call | n8n webhook (optional) | `src/services/walletService.js` | `balance_after_cents < 2000` |
| Auto-reload threshold | n8n webhook | `src/services/walletService.js` | `auto_reload_threshold_cents` |
| Dashboard wallet view | In-response JSON | `src/routes/dashboard.js` | Every wallet GET |

---

## n8n Webhook Payloads

n8n is the async distribution backbone. Fire-and-forget from Express — never await these in the request path.

```javascript
// src/services/bookingService.js — fireN8nWebhook pattern
async function fireN8nWebhook(event, payload) {
  if (!process.env.N8N_WEBHOOK_BASE_URL) return;

  // Fire-and-forget: never await in request path
  fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/webhook/${event}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(err => logger.error('n8n webhook failed', { event, error: err.message }));
}
```

### Wallet Empty Webhook

```javascript
// Trigger in vapi.js when checkBalance() returns false
fireN8nWebhook('wallet-empty', {
  client_id: client.id,
  business_name: client.business_name,
  business_phone: client.business_phone,
  caller_phone: callerPhone,    // The call that was blocked
  current_tier: wallet.tier,
  next_tier: getNextTier(wallet.tier),
  dashboard_url: `https://app.aiops.com/dashboard/${client.id}/wallet`,
  // n8n uses this to render the upgrade CTA in the email
  upgrade_savings: getNextTier(wallet.tier)
    ? `${TIER_RATES[wallet.tier] - TIER_RATES[getNextTier(wallet.tier)]}¢/min`
    : null,
});
```

### Low-Balance Webhook

```javascript
// Trigger in walletService.js deductCallCost
fireN8nWebhook('wallet-low', {
  client_id: clientId,
  balance_cents: balanceAfter,
  current_tier: wallet.tier,
  calls_remaining_estimate: Math.floor(balanceAfter / (TIER_RATES[wallet.tier] * 4)), // ~4 min avg
});
```

---

## Twilio SMS Patterns

Twilio SMS is the highest-conversion channel for wallet reload prompts. Blue-collar operators check their phones constantly.

```javascript
// src/integrations/twilio.js — sendSms wrapper
async function sendUpgradeAlert(operatorPhone, clientName, balanceDollars, reloadUrl) {
  // NEVER reveal client_id or internal IDs in SMS
  const message = balanceDollars <= 0
    ? `[AI Ops] ${clientName}: Your agent is in message-only mode. Reload to restore: ${reloadUrl}`
    : `[AI Ops] ${clientName}: Balance at $${balanceDollars}. Your agent will pause at $0. Reload: ${reloadUrl}`;

  return twilioClient.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: operatorPhone,
    body: message,
  });
}
```

See the **twilio** skill for full SMS setup and error handling patterns.

---

## Channel Selection Logic

Not every low-balance event should trigger SMS — that becomes noise. Use this decision tree:

```javascript
// src/utils/upgradeHelper.js
function shouldSendUpgradeSms(wallet, previousBalance) {
  // Only SMS on meaningful threshold crossings, not every call
  const THRESHOLDS = [5000, 2000, 500, 0]; // $50, $20, $5, $0

  return THRESHOLDS.some(threshold =>
    previousBalance > threshold && wallet.balance_cents <= threshold
  );
}

// Usage in walletService.js after deductCallCost:
if (shouldSendUpgradeSms(wallet, previousBalance)) {
  fireN8nWebhook('wallet-threshold-crossed', {
    client_id: clientId,
    balance_cents: wallet.balance_cents,
    previous_balance_cents: previousBalance,
  });
}
```

### Anti-Pattern: SMS on Every Low-Balance Post-Call

**NEVER** send an SMS after every call once balance is below threshold. The operator gets one message per threshold crossing, not per call. Over-messaging from billing events destroys trust faster than a balance issue does.

```javascript
// BAD — sends SMS after every call when balance < $20
if (balanceAfter < 2000) {
  await sendUpgradeAlert(operatorPhone, ...);
}

// GOOD — only on threshold crossing
if (shouldSendUpgradeSms(wallet, previousBalance)) {
  fireN8nWebhook('wallet-threshold-crossed', { ... });
}
```

See the **mapping-conversion-events** skill for logging which distribution events led to reloads.
