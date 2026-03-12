# Conversion Optimization Reference

## Contents
- Upgrade Trigger Surfaces
- Anti-Patterns
- Wallet Response Enrichment
- Zero-Balance Conversion Flow
- Checklist

---

## Upgrade Trigger Surfaces

There are exactly three places in this codebase where upgrade conversion happens. Each needs specific treatment.

| Surface | File | Trigger Condition |
|---------|------|-------------------|
| Zero-balance agent fallback | `src/routes/vapi.js` | `checkBalance()` === false |
| Post-call wallet deduction | `src/services/walletService.js` | `balance_after_cents < 2000` |
| Dashboard wallet view | `src/routes/dashboard.js` | Every `GET /api/v1/dashboard/wallet` |

---

## Anti-Patterns

### WARNING: Generic "Your Balance Is Low" Message

**The Problem:**

```javascript
// BAD — no tier context, no savings, no call to action
if (balanceAfter < 2000) {
  return { ...result, warning: 'Your balance is low. Please top up.' };
}
```

**Why This Breaks:**
1. "Top up" with no amount anchor gives no urgency or framing
2. Misses the upgrade opportunity entirely — the client may not know a tier change saves money
3. No CTA means the operator has to figure out next steps themselves

**The Fix:**

```javascript
// GOOD — specific tier, specific savings, specific action
if (balanceAfter < 2000) {
  const nextTier = getNextTier(wallet.tier);
  return {
    ...result,
    low_balance_warning: {
      balance_cents: balanceAfter,
      message: `Balance below $20. Your ${wallet.tier} rate is ${TIER_RATES[wallet.tier]}¢/min.`,
      cta: nextTier
        ? `Reload $50+ to unlock ${nextTier} at ${TIER_RATES[nextTier]}¢/min — save ${TIER_RATES[wallet.tier] - TIER_RATES[nextTier]}¢ per minute.`
        : 'Reload now to keep your agent active.',
      reload_url: '/dashboard/wallet/reload',
    },
  };
}
```

---

### WARNING: Showing Upgrade Prompts to Enterprise Tier

**The Problem:**

```javascript
// BAD — always shows upgrade_available regardless of tier
res.json({ ...wallet, upgrade_available: buildUpgradePrompt(wallet.tier) });
```

**Why This Breaks:**
Enterprise is the top tier. Showing `upgrade_available: null` is fine, but rendering an empty upgrade section clutters the response and signals poor product awareness.

**The Fix:**

```javascript
// GOOD — only include upgrade_available when an upgrade exists
const nextTier = getNextTier(wallet.tier); // returns null for 'enterprise'
res.json({
  ...wallet,
  ...(nextTier && { upgrade_available: buildUpgradePrompt(wallet.tier, nextTier) }),
});
```

---

## Wallet Response Enrichment

The `GET /api/v1/dashboard/wallet` response in `src/routes/dashboard.js` currently returns raw wallet data. Add conversion context:

```javascript
// src/routes/dashboard.js
router.get('/wallet', async (req, res, next) => {
  try {
    const wallet = await getWalletInfo(req.clientId);
    if (!wallet) return res.status(404).json({ error: 'No wallet found' });

    const { getNextTier, buildUpgradePrompt } = require('../utils/upgradeHelper');
    const nextTier = getNextTier(wallet.tier);
    const isLow = wallet.balance_cents < 2000;
    const isEmpty = wallet.balance_cents <= 0;

    res.json({
      ...wallet,
      status_label: isEmpty ? 'inactive' : isLow ? 'low' : 'active',
      low_balance_warning: isLow && !isEmpty
        ? `Less than $20 remaining at ${TIER_RATES[wallet.tier]}¢/min — agent will go to message-only at $0.`
        : null,
      empty_balance_message: isEmpty
        ? `Agent is in message-only mode. Top up to restore full booking and payment capabilities.`
        : null,
      upgrade_available: nextTier ? buildUpgradePrompt(wallet.tier, nextTier) : null,
    });
  } catch (err) {
    next(err);
  }
});
```

---

## Zero-Balance Conversion Flow

When `checkBalance()` returns false in `src/routes/vapi.js`, the agent must:
1. Still be helpful to the caller (take a message)
2. Create urgency for the operator to reload

```javascript
// src/routes/vapi.js — zero-balance branch
const hasFunds = await checkBalance(client.id);

if (!hasFunds) {
  logger.warn('Call blocked — zero wallet balance', { client_id: client.id });

  // Fire n8n webhook so operator gets notified immediately
  fireN8nWebhook('wallet-empty', {
    client_id: client.id,
    business_name: client.business_name,
    caller_phone: callerPhone,
  });

  return res.json({
    id: `chatcmpl-nofunds-${Date.now()}`,
    object: 'chat.completion',
    choices: [{
      message: {
        role: 'assistant',
        content: `I'm only able to take a message right now. ${client.business_name} will follow up with you soon. What's your name and the best number to reach you?`,
      },
    }],
  });
}
```

The n8n webhook triggers the real upgrade moment: an email/SMS to the operator with a direct reload link. That's where the conversion happens — not in the agent response.

---

## Upgrade Moment Checklist

Copy this checklist when adding any upgrade prompt:

- [ ] Is the current tier named explicitly in the message?
- [ ] Is the savings amount (¢/min) shown, not just the tier name?
- [ ] Does the CTA include a concrete action (reload amount, link)?
- [ ] Is the message omitted for enterprise tier?
- [ ] Is the wallet event logged for funnel analysis?
- [ ] Does zero-balance trigger a backend notification (n8n webhook)?

See the **mapping-conversion-events** skill for logging upgrade funnel events.
