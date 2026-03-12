# Content SEO Reference

## Contents
- Target keywords for AI Ops verticals
- Content surfaces in this codebase
- API response copy that affects SEO indirectly
- Vertical-specific landing page strategy
- WARNING: No content management layer

---

## Target Keywords by Vertical

This platform serves blue-collar service businesses. Keyword strategy should map
to each vertical's search intent:

| Vertical | Primary Keyword | Long-tail Target |
|----------|----------------|------------------|
| HVAC | AI answering service for HVAC | automated call booking HVAC company |
| Plumbing | AI phone agent plumber | plumbing appointment booking software |
| Electrical | AI voice agent electrician | after-hours call answering electrical |
| Spa | automated booking spa | AI receptionist day spa |
| Cleaning | cleaning company call automation | automated scheduling cleaning service |
| Restaurant | restaurant reservation AI | AI phone agent restaurant |

---

## Content Surfaces in This Codebase

**Currently indexed (if crawlable):** Nothing — no HTML is served.

**Should be indexed once HTML is added:**
- `/` — Platform homepage
- `/pricing` — Wallet tier comparison
- `/verticals/hvac` — HVAC-specific landing page
- `/verticals/plumbing` — Plumbing-specific landing page
- `/onboard` — Intake form landing page

**NEVER index:**
- `/api/*` — All API endpoints
- `/health` — Infrastructure health check
- `/dashboard/*` — Auth-gated client dashboard

---

## Vertical Landing Page Template

Each vertical needs a dedicated page. Structure them consistently:

```javascript
// src/routes/verticals.js
'use strict';
const router = require('express').Router();
const { buildHead } = require('../utils/htmlHelpers');

const VERTICALS = {
  hvac: {
    title: 'AI Phone Agent for HVAC Companies | AI Ops',
    description: 'Never miss an HVAC service call. AI Ops answers 24/7, books appointments in HouseCall Pro, and collects deposits automatically.',
    headline: 'Your HVAC Company's 24/7 AI Receptionist',
    fsm: 'HouseCall Pro, ServiceTitan',
  },
  plumbing: {
    title: 'Automated Call Answering for Plumbers | AI Ops',
    description: 'An AI agent that answers plumbing calls, books emergency service slots, and texts payment links — while you're on the job.',
    headline: 'Answer Every Plumbing Call. Even at 2am.',
    fsm: 'HouseCall Pro, Jobber',
  },
};

router.get('/verticals/:vertical', (req, res, next) => {
  const meta = VERTICALS[req.params.vertical];
  if (!meta) return next(); // 404
  const head = buildHead({
    title: meta.title,
    description: meta.description,
    canonicalUrl: `${process.env.PUBLIC_URL}/verticals/${req.params.vertical}`,
  });
  res.send(`<!DOCTYPE html><html>${head}<body>...</body></html>`);
});

module.exports = router;
```

---

## WARNING: No Content Management Layer

**The Problem:** All copy is hardcoded in route files.

**Why This Breaks:**
1. Updating landing page copy requires a code deploy
2. A/B testing messaging requires branching — slow iteration
3. Non-technical team members can't update content

**The Fix (minimal):** Extract copy to JSON config files:

```javascript
// src/config/verticalCopy.json
{
  "hvac": {
    "title": "AI Phone Agent for HVAC Companies | AI Ops",
    "headline": "Your HVAC Company's 24/7 AI Receptionist",
    "bullets": [
      "Answers calls 24/7 — never send a customer to voicemail",
      "Books directly into HouseCall Pro and ServiceTitan",
      "Collects deposits via Stripe or Square before you arrive"
    ]
  }
}
```

---

## Copy That Affects SEO Indirectly

The `POST /api/v1/onboard` response and agent persona text in `src/services/promptCompiler.js`
don't affect search rankings directly, but they do affect conversion from organic traffic.
Use clear, vertical-specific language. See the **crafting-page-messaging** skill for
copy guidelines that align with search intent.

---

## Internal Linking Strategy

Once multiple vertical pages exist, link between them:
- Homepage → All vertical pages
- Each vertical page → Pricing, Onboard CTA
- Blog/case studies → Relevant vertical pages

Keep anchor text descriptive: "AI agent for HVAC companies" not "click here."