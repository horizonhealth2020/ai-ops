---
name: calibrating-paid-campaigns
description: |
  Aligns paid acquisition with landing pages and pixels for the AI Ops multi-tenant voice agent platform.
  Use when: setting up conversion tracking for paid ads targeting blue-collar service businesses,
  wiring campaign UTM parameters through POST /api/v1/onboard, attributing signups to ad campaigns,
  auditing the onboarding funnel for paid traffic alignment, instrumenting Stripe wallet top-up
  events as conversion goals, or diagnosing why paid leads drop off before first live call.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Calibrating Paid Campaigns

This is a pure API backend — no frontend, no pixel scripts in-repo. Paid campaign tracking must be instrumented through the `POST /api/v1/onboard` endpoint and downstream call/wallet events. UTM attribution, pixel firing, and conversion reporting all happen server-side or via external tag managers pointed at this API's webhook surfaces.

**No ad pixels were found in this repo.** Confirm with the team whether pixels are managed in an external tag manager or a separate frontend before adding any tracking code.

## Quick Start

### Capture UTM Attribution at Onboard

```javascript
// src/routes/onboard.js — extend intake payload to accept UTM params
router.post('/api/v1/onboard', async (req, res, next) => {
  try {
    const {
      business_name, phone, vertical, tier,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term
    } = req.body;

    await pool.query(
      `INSERT INTO clients (business_name, phone, vertical, billing_tier,
        utm_source, utm_medium, utm_campaign, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [business_name, phone, vertical, tier || 'standard',
       utm_source, utm_medium, utm_campaign]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

### Emit Conversion Event After First Call

```javascript
// src/routes/call.js — POST /api/v1/call/complete
// Fire n8n webhook for paid conversion attribution after first completed call
const isFirstCall = callCount === 1;
if (isFirstCall && client.utm_source) {
  await fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/paid-conversion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      utm_source: client.utm_source,
      utm_campaign: client.utm_campaign,
      wallet_tier: client.billing_tier,
      conversion_value_cents: callCostCents
    })
  });
}
```

## Key Concepts

| Concept | Where it Lives | Example |
|---------|---------------|---------|
| UTM capture | `POST /api/v1/onboard` request body | `utm_source=google&utm_campaign=hvac-search` |
| Conversion event | `POST /api/v1/call/complete` → n8n webhook | First call completed = activated |
| Attribution query | `clients` table `utm_*` columns | `SELECT utm_campaign, COUNT(*) FROM clients` |
| Wallet top-up | `walletService.js` + Stripe/Square | Top-up = revenue conversion signal |
| Pixel firing | External (n8n or tag manager) | Server-to-server Conversions API |

## Common Patterns

### Server-Side Conversion API (Preferred over Browser Pixels)

**When:** Targeting HVAC/plumbing owners who may have ad blockers, or when there's no frontend.

```javascript
// Fire Meta Conversions API via n8n after wallet top-up
// Triggered from walletService.js reload event → n8n webhook
const conversionPayload = {
  event_name: 'Purchase',
  event_time: Math.floor(Date.now() / 1000),
  user_data: { ph: hashedPhone, em: hashedEmail },
  custom_data: {
    currency: 'USD',
    value: (amountCents / 100).toFixed(2),
    content_name: billingTier
  }
};
```

### Attribution Reporting Query

```javascript
// Pull campaign performance from PostgreSQL
const result = await pool.query(
  `SELECT utm_campaign, billing_tier, COUNT(*) as signups,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activated
   FROM clients
   WHERE utm_source IS NOT NULL
   GROUP BY utm_campaign, billing_tier
   ORDER BY signups DESC`,
  []
);
```

## See Also

- [conversion-optimization](references/conversion-optimization.md)
- [content-copy](references/content-copy.md)
- [distribution](references/distribution.md)
- [measurement-testing](references/measurement-testing.md)
- [growth-engineering](references/growth-engineering.md)
- [strategy-monetization](references/strategy-monetization.md)

## Related Skills

- See the **mapping-conversion-events** skill for defining funnel events and logEvent() patterns
- See the **accelerating-first-run** skill for reducing time-to-first-call after paid signup
- See the **strengthening-upgrade-moments** skill for wallet top-up as conversion goal
- See the **stripe** skill for Stripe webhook handling used as conversion signals
- See the **tuning-landing-journeys** skill for onboard intake form optimization
- See the **clarifying-market-fit** skill for vertical-specific ad messaging alignment
- See the **structuring-offer-ladders** skill for tier selection on paid landing pages
