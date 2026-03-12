# Content Copy Reference

## Contents
- Ad-to-Onboard Message Match
- Vertical-Specific Copy Signals
- API Response Copy for Paid Cohorts
- Anti-Patterns
- Tier Messaging Alignment

---

## Ad-to-Onboard Message Match

The single biggest paid campaign failure is **message mismatch**: your ad says "AI receptionist for HVAC" and the onboard form says "Business Phone Agent Setup." The prospect's brain stalls.

The `POST /api/v1/onboard` response is your first opportunity to confirm they're in the right place:

```javascript
// src/routes/onboard.js — vertical-aware welcome message
const VERTICAL_WELCOME = {
  hvac: 'Your AI dispatcher is being set up. It handles after-hours calls, books service appointments, and never puts a customer on hold.',
  plumbing: 'Your AI answering service is ready. It handles emergency calls 24/7 and books same-day appointments automatically.',
  spa: 'Your AI receptionist is being configured. It books treatments, handles rescheduling, and remembers returning clients.',
  electrical: 'Your AI service coordinator is live. It routes calls, books estimates, and captures every lead.',
  cleaning: 'Your AI booking agent is set up. It handles new client inquiries and schedules recurring cleanings.',
  restaurant: 'Your AI host assistant is ready. It handles reservations, wait times, and catering inquiries.'
};

res.json({
  success: true,
  message: VERTICAL_WELCOME[vertical] || 'Your AI agent is being configured.',
  next_step: 'wallet_topup'
});
```

This copy should mirror the ad's value promise word-for-word. See the **tightening-brand-voice** skill for copy review patterns.

---

## Vertical-Specific Copy Signals

Ad copy that converts for blue-collar service businesses follows a predictable pattern. These signals belong in landing page copy (external) but must align with the `vertical` values accepted by the API.

| Vertical | API `vertical` value | High-converting signal words |
|----------|---------------------|------------------------------|
| HVAC | `hvac` | "after-hours", "dispatch", "emergency", "no voicemail" |
| Plumbing | `plumbing` | "24/7", "emergency leak", "same-day booking" |
| Spa/Salon | `spa` | "never miss a booking", "rescheduling", "client memory" |
| Electrical | `electrical` | "estimate calls", "lead capture", "licensed contractor" |
| Cleaning | `cleaning` | "recurring clients", "new client intake", "schedule fills itself" |
| Restaurant | `restaurant` | "reservation handling", "wait list", "catering inquiries" |

NEVER use generic SaaS copy ("streamline your workflow", "AI-powered solution") in ads targeting these verticals. These owners respond to specific, concrete operational problems.

---

## API Response Copy for Paid Cohorts

Paid signups are higher-intent but also higher-expectation. They clicked an ad promising a specific outcome. If the first API response is generic, they churn immediately.

```javascript
// GOOD — onboard response scoped to tier + vertical
const tierCopy = {
  standard: 'Your agent is live on the standard plan ($0.40/min). Top up your wallet to activate.',
  growth:   'Growth plan activated ($0.32/min). Your agent handles 3× more concurrent calls.',
  scale:    'Scale plan active ($0.27/min). Priority routing and extended call memory included.',
  enterprise: 'Enterprise configuration in progress. Your account manager will contact you within 1 business day.'
};

res.json({
  success: true,
  activation_message: tierCopy[billing_tier],
  wallet_minimum_cents: 2000,  // $20 minimum top-up
  next_step: 'wallet_topup'
});
```

---

## WARNING: Generic Error Copy Kills Paid Conversions

**The Problem:**

```javascript
// BAD — generic error leaks confusion into a paid funnel
res.status(400).json({ error: 'Invalid request' });
```

**Why This Breaks:**
1. Paid traffic costs money per click. An unclear error is a wasted acquisition.
2. Owners don't retry — they bounce and never return.
3. Support load increases because there's no self-serve resolution path.

**The Fix:**

```javascript
// GOOD — actionable error with next step
res.status(400).json({
  error: 'phone_already_registered',
  message: 'This phone number already has an account. Log in to your dashboard to manage it.',
  dashboard_url: process.env.DASHBOARD_URL
});
```

---

## Tier Messaging Alignment

The `billing_tier` field accepted by `POST /api/v1/onboard` must match the tier name on the ad's landing page exactly. Mismatches cause "I thought I signed up for growth" support tickets.

```
Ad copy: "Growth Plan — $0.32/min"
                                    ↓
Landing page tier selector: value="growth"
                                    ↓
POST /api/v1/onboard: { billing_tier: "growth" }
                                    ↓
clients table: billing_tier = 'growth'
                                    ↓
walletService.js: TIER_RATES['growth'] = 32 (cents)
```

Any break in this chain means the client was billed at the wrong rate. See the **structuring-offer-ladders** skill for tier definition patterns.
