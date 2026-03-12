# Conversion Optimization Reference

## Contents
- Pixel Status
- Conversion Funnel for Paid Traffic
- Landing Page Alignment Checklist
- Anti-Patterns
- Onboard Endpoint as Conversion Surface

---

## Pixel Status

**No ad pixels were found in this repository.** This is a pure Express API with no frontend HTML. Pixels must live in:
- An external landing page (not in this repo)
- Google Tag Manager configured server-side
- n8n workflows firing server-to-server Conversions APIs

Before adding any pixel, confirm the frontend repo with the team. NEVER inject `<script>` tags into Express JSON responses.

---

## Conversion Funnel for Paid Traffic

```
Ad Click → Landing Page (external) → POST /api/v1/onboard → Wallet Top-Up → First Call
    ↑                                      ↑                      ↑             ↑
  UTM params                          Capture UTMs            Stripe/Square   Activation
```

The backend owns steps 3–4. Steps 1–2 are external. The conversion goal that maps to ad spend ROI is **first completed call** (`POST /api/v1/call/complete` with `call_duration_seconds > 0`).

---

## Landing Page Alignment Checklist

Copy this checklist and track progress:

- [ ] Landing page headline matches ad copy exactly (keyword echo)
- [ ] CTA button label matches the form submit action ("Start Free" vs "Get Started" — pick one)
- [ ] UTM parameters pass through to `POST /api/v1/onboard` request body
- [ ] `vertical` field in onboard payload matches the ad's target vertical (hvac, plumbing, etc.)
- [ ] `billing_tier` pre-selected on landing page matches the ad's offer (standard vs growth)
- [ ] Onboard success response triggers pixel fire (via n8n or tag manager)
- [ ] Wallet top-up page shows the same tier price from the ad

---

## WARNING: UTM Parameters Lost at Onboard

**The Problem:**

```javascript
// BAD - discards attribution data
router.post('/api/v1/onboard', async (req, res, next) => {
  const { business_name, phone, vertical } = req.body;
  // utm_source, utm_campaign silently dropped
  await pool.query('INSERT INTO clients ...', [business_name, phone, vertical]);
});
```

**Why This Breaks:**
1. You cannot attribute signups back to campaigns
2. ROAS reporting is impossible — you see spend but not which campaigns convert
3. You cannot optimize ad creative because there's no signal on what worked

**The Fix:**

```javascript
// GOOD - persist UTMs with every client record
const {
  business_name, phone, vertical, billing_tier,
  utm_source, utm_medium, utm_campaign, utm_content
} = req.body;

await pool.query(
  `INSERT INTO clients
     (business_name, phone, vertical, billing_tier,
      utm_source, utm_medium, utm_campaign, utm_content, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
  [business_name, phone, vertical, billing_tier || 'standard',
   utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null]
);
```

Add the migration:

```sql
-- migrations/005_add_utm_columns.sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS utm_source    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS utm_medium    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS utm_campaign  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS utm_content   VARCHAR(255);
```

---

## Onboard Endpoint as Conversion Surface

The `POST /api/v1/onboard` response is the only place this backend can influence post-click conversion. The response should:

```javascript
// src/routes/onboard.js — structured response for tracking
res.json({
  success: true,
  client_id: newClientId,
  next_step: 'wallet_topup',         // drive to wallet top-up immediately
  wallet_url: `${DASHBOARD_URL}/wallet?client_id=${newClientId}`,
  // Include tier so landing page can fire pixel with correct value
  billing_tier: billingTier,
  rate_per_minute_cents: TIER_RATES[billingTier]
});
```

The external landing page reads `next_step` and `billing_tier` to fire the correct conversion event with the right value. See the **strengthening-upgrade-moments** skill for wallet top-up conversion patterns.
