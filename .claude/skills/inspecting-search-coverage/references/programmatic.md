# Programmatic SEO Reference

## Contents
- When programmatic SEO applies to this backend
- Vertical page generation from database
- Dynamic sitemap with all indexable URLs
- Route patterns for scale
- WARNING: Thin content risk

---

## When Programmatic SEO Applies Here

Programmatic SEO makes sense when this platform grows to serve many clients and
each client's vertical/city combination becomes a landing page. Example:
- `/hvac/miami-fl` — HVAC AI agent for Miami
- `/plumbing/fort-lauderdale-fl` — Plumbing agent for Fort Lauderdale

This maps naturally to the existing multi-tenant structure — each client has a
`vertical` and `service_area` in the database.

---

## Dynamic Routes from Database

```javascript
// src/routes/landing.js
'use strict';
const router = require('express').Router();
const pool = require('../config/database');

// Pattern: /:vertical/:city-state
router.get('/:vertical/:location', async (req, res, next) => {
  try {
    const { vertical, location } = req.params;

    // Pull aggregate stats to make pages non-thin
    const result = await pool.query(
      `SELECT
         COUNT(*) as client_count,
         AVG(wallet_balance_cents) as avg_balance
       FROM clients
       WHERE vertical = $1
         AND is_active = true
         AND service_area_slug = $2`,
      [vertical, location]
    );

    if (result.rows[0].client_count === '0') return next(); // 404

    res.render('vertical-location', {
      vertical,
      location,
      clientCount: result.rows[0].client_count,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

---

## Dynamic Sitemap Including Programmatic Pages

```javascript
// Extend the seo.js sitemap route
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const baseUrl = process.env.PUBLIC_URL || '';

    // Fetch all active vertical+location combinations
    const result = await pool.query(
      `SELECT DISTINCT vertical, service_area_slug
       FROM clients
       WHERE is_active = true
         AND service_area_slug IS NOT NULL
       ORDER BY vertical, service_area_slug`
    );

    const staticUrls = ['/', '/pricing', '/onboard'].map(path =>
      `<url><loc>${baseUrl}${path}</loc><changefreq>weekly</changefreq></url>`
    );

    const dynamicUrls = result.rows.map(row =>
      `<url>
        <loc>${baseUrl}/${row.vertical}/${row.service_area_slug}</loc>
        <changefreq>monthly</changefreq>
      </url>`
    );

    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...dynamicUrls].join('\n')}
</urlset>`);
  } catch (err) {
    next(err);
  }
});
```

---

## Database Schema Addition for Programmatic Pages

Add `service_area_slug` to the `clients` table:

```sql
-- migrations/004_add_service_area_slug.sql
ALTER TABLE clients
ADD COLUMN service_area_slug VARCHAR(100),
ADD COLUMN service_area_display VARCHAR(100);

-- Example: 'miami-fl', 'fort-lauderdale-fl'
CREATE INDEX idx_clients_vertical_area ON clients (vertical, service_area_slug)
  WHERE is_active = true;
```

---

## WARNING: Thin Content Risk

**The Problem:**

```javascript
// BAD — page has no unique content, just a template with swapped location name
res.render('location', { city: 'Miami', vertical: 'HVAC' });
// Google will deindex these as thin/duplicate content
```

**Why This Breaks:**
1. Google's Helpful Content system penalizes pages that exist only for SEO
2. All location pages look identical — no differentiation signal
3. Pages with <300 words of unique content rarely rank

**The Fix:** Include unique, data-driven content per page:
- Number of clients in that area
- Average response time
- Vertical-specific stats from call logs (anonymized)
- Real testimonials tied to location/vertical

```javascript
// Pull real data to populate each page uniquely
const stats = await pool.query(
  `SELECT
     COUNT(DISTINCT cl.client_id) as businesses_using,
     COUNT(l.log_id) as calls_handled,
     AVG(l.duration_seconds) as avg_call_duration
   FROM clients cl
   LEFT JOIN call_logs l ON cl.client_id = l.client_id
   WHERE cl.vertical = $1
     AND cl.service_area_slug = $2
     AND cl.is_active = true`,
  [vertical, location]
);
```

---

## Crawl Budget Management

For large programmatic deployments, protect crawl budget:

```javascript
// robots.txt — allow only populated location pages
router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /health',
    'Allow: /',
    `Sitemap: ${process.env.PUBLIC_URL}/sitemap.xml`,
  ].join('\n'));
});
```

Only include URLs in the sitemap when they have sufficient content — use the
query above to filter out locations with zero activity.