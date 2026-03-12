# Conversion Optimization Reference

## Contents
- Activation funnel overview
- Onboard payload completeness
- Wallet top-up conversion
- Anti-patterns
- Checklist

---

## Activation Funnel

A client converts when their agent handles a live call. Three blockers prevent this:

1. **Incomplete onboard payload** — `system_prompt` never compiles cleanly
2. **Empty wallet** — `walletService.checkBalance()` returns `false`, agent drops to message-only
3. **Vapi not configured** — client hasn't pointed Vapi to this server with their `client_id`

Only #1 and #2 are addressable in this backend. #3 requires external docs/email.

---

## Onboard Payload Completeness

`src/routes/onboard.js` accepts 20+ fields but only `business_name` and `business_phone` are
validated. Every missing field degrades the compiled prompt and agent quality.

**Minimum viable onboard payload for a functional agent:**

```javascript
// Minimum fields for a prompt that actually works
{
  business_name: "Apex Plumbing",
  business_phone: "+19545550100",
  vertical: "hvac",                         // Drives opening line in prompt
  timezone: "America/New_York",
  agent_name: "Alex",
  greeting_script: "Thanks for calling Apex Plumbing, this is Alex!",
  services: [{ name: "AC Repair", duration_min: 60 }],
  wallet_tier: "standard"
}
```

**Full payload for maximum first-call quality:**

```javascript
// All fields that feed into promptCompiler.assemblePrompt()
{
  // Required for routing
  business_phone: "+19545550100",
  vertical: "hvac",
  // Persona quality
  agent_name: "Alex",
  tone_tags: ["friendly", "professional"],
  phrases_use: ["We're happy to help"],
  phrases_avoid: ["I don't know", "Maybe"],
  // Conversion context
  promotions: "10% off first service this month",
  differentiators: "Licensed, insured, 24/7 emergency service",
  // Call handling
  transfer_phone: "+19545559999",
  angry_handling: "Stay calm, offer to transfer to manager",
  after_hours_behavior: "Take a message and promise callback next business day"
}
```

---

## Wallet Top-Up Conversion

The `wallets` table starts at `balance_cents = 0`. The agent enters message-only mode
immediately if a call arrives with zero balance. This is the #1 activation blocker.

**Add wallet status to the onboard 201 response:**

```javascript
// src/routes/onboard.js — after COMMIT
res.status(201).json({
  client_id: clientId,
  business_phone,
  status: 'active',
  wallet: {
    balance_cents: 0,
    tier: wallet_tier || 'standard',
    action_required: true,
    message: 'Add wallet balance to enable your AI agent',
  },
});
```

**Surface wallet empty state in dashboard/config:**

```javascript
// src/routes/dashboard.js — GET /config
const wallet = await getWalletInfo(req.clientId);
res.json({
  ...config,
  wallet_status: wallet.balance_cents > 0 ? 'active' : 'needs_funding',
  wallet_balance_cents: wallet.balance_cents,
});
```

---

### WARNING: Silent Wallet Empty State

**The Problem:**

```javascript
// BAD — no wallet status in dashboard config response
res.json({
  business_name: client.business_name,
  // ... other fields
  // wallet never mentioned — client doesn't know agent is disabled
});
```

**Why This Breaks:**
1. Client completes onboarding, configures Vapi, gets a call — agent is silent
2. No error surfaced in dashboard; client assumes technical issue
3. Churn follows within 48 hours

**The Fix:**
Always include `wallet_status` in `GET /api/v1/dashboard/config` response.

---

## Activation Checklist

Copy this checklist when auditing a new client's first-run state:

```
- [ ] POST /api/v1/onboard returned 201 with client_id
- [ ] clients.system_prompt is non-null (promptCompiler ran)
- [ ] wallets.balance_cents > 0
- [ ] Vapi assistant has metadata.client_id set to the UUID
- [ ] Vapi custom LLM URL points to /api/v1/context/inject
- [ ] At least one appointment_type row exists
- [ ] business_hours has at least one is_open = true row
```

---

## Related Skills

- See the **mapping-conversion-events** skill for instrumenting activation milestones
- See the **structuring-offer-ladders** skill for wallet tier upgrade flows
- See the **crafting-page-messaging** skill for wallet empty state copy
