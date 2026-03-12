# On-Page SEO Reference

## Contents
- HTML responses from this Express server
- Meta tags in error pages
- Open Graph for any server-rendered content
- Title/description patterns
- WARNING: No HTML rendering layer detected

---

## Context: This Is a Backend API

This Express server returns JSON from all `/api/v1/*` routes and has no templating
engine (`ejs`, `pug`, `handlebars`) in its dependencies. On-page SEO only applies
if HTML is added — either via a templating engine, a `public/` directory, or a
reverse proxy serving a frontend alongside this API.

If you add HTML rendering, follow these patterns.

---

## Meta Tags in Server-Rendered HTML

If you add Express HTML responses (e.g., a landing page or error page):

```javascript
// src/utils/htmlHelpers.js
'use strict';

function buildHead({ title, description, canonicalUrl, ogImage }) {
  return `
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
</head>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { buildHead };
```

---

## Title and Description Patterns

**For the SaaS platform itself:**

```javascript
const PAGE_META = {
  home: {
    title: 'AI Ops — AI Voice Agent for HVAC, Plumbing & Field Services',
    description: 'Automate inbound calls, book appointments, and take payments with an AI phone agent built for blue-collar service businesses.',
  },
  pricing: {
    title: 'Pricing — AI Ops Voice Agent Plans',
    description: 'Prepaid wallet billing from $0.23/min. Standard, Growth, Scale, and Enterprise tiers for HVAC, plumbing, electrical, and spa businesses.',
  },
};
```

### WARNING: Generic Titles Across All Pages

**The Problem:**
```javascript
// BAD — same title for every page
res.render('page', { title: 'AI Ops' });
```

**Why This Breaks:**
1. Google deduplicates near-identical titles and may rewrite them
2. Click-through rates drop when titles don't match search intent
3. All pages compete against each other for the same keyword

**The Fix:** Use unique, intent-matched titles per page from `PAGE_META`.

---

## Open Graph for Social Sharing

When HVAC or plumbing businesses share their onboarding link, the preview matters.
Set OG tags on the onboarding landing page:

```javascript
// In a hypothetical GET /onboard landing page route
router.get('/onboard', (req, res) => {
  const { buildHead } = require('../utils/htmlHelpers');
  const head = buildHead({
    title: 'Set Up Your AI Phone Agent — AI Ops',
    description: 'Get an AI agent answering calls and booking jobs in under 10 minutes. No contracts.',
    canonicalUrl: `${process.env.PUBLIC_URL}/onboard`,
    ogImage: `${process.env.PUBLIC_URL}/images/og-onboard.png`,
  });
  res.send(`<!DOCTYPE html><html>${head}<body>...</body></html>`);
});
```

---

## Error Page SEO

The global error handler (`src/middleware/errorHandler.js`) should return `noindex`
for any HTML error responses:

```javascript
// In errorHandler.js — for HTML requests (Accept: text/html)
if (req.accepts('html')) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(err.status || 500).send(errorHtml);
}
```

---

## Validation

```bash
# Check title and description are present
curl -s https://YOUR_RAILWAY_URL/ | grep -E '<title>|meta name="description"'

# Verify Open Graph tags
curl -s https://YOUR_RAILWAY_URL/ | grep 'og:'

# Confirm canonical is set
curl -s https://YOUR_RAILWAY_URL/ | grep canonical
```