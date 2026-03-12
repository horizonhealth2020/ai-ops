# Technical SEO Reference

## Contents
- robots.txt and X-Robots-Tag
- Sitemap generation
- Canonical headers
- Crawl budget for API routes
- WARNING: Missing static file serving

---

## robots.txt and X-Robots-Tag

This Express server has no `robots.txt` by default. Crawlers hitting it will crawl
every route including all `/api/v1/*` endpoints — wasting crawl budget and potentially
exposing API surface in search indexes.

**Add a robots.txt route:**

```javascript
// src/routes/seo.js
'use strict';
const router = require('express').Router();

router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /health',
    `Sitemap: ${process.env.PUBLIC_URL || ''}/sitemap.xml`,
  ].join('\n'));
});

module.exports = router;
```

**Register before all other routes in `src/index.js`:**

```javascript
// Register SEO routes early so they never get caught by auth middleware
app.use(require('./routes/seo'));
app.use('/api/v1', vapiRouter);
// ...rest of routes
```

**Add X-Robots-Tag to all API responses:**

```javascript
// src/middleware/noIndex.js — prevents API JSON from appearing in search results
'use strict';
module.exports = function noIndex(req, res, next) {
  if (req.path.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
};
```

---

## Sitemap Generation

If public-facing pages exist (marketing, docs, onboarding landing), generate a sitemap:

```javascript
// src/routes/seo.js — add alongside robots.txt
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PGBOUNCER_URL });

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const baseUrl = process.env.PUBLIC_URL || '';
    const staticUrls = ['/', '/pricing', '/contact'];
    const urls = staticUrls.map(path => `
  <url>
    <loc>${baseUrl}${path}</loc>
    <changefreq>weekly</changefreq>
  </url>`).join('');

    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`);
  } catch (err) {
    next(err);
  }
});
```

---

## Canonical Headers for API Responses

If the same content is accessible via multiple URLs (e.g., with/without trailing slash),
set a `Link` header:

```javascript
// Middleware for canonical URL enforcement
app.use((req, res, next) => {
  const canonical = `${process.env.PUBLIC_URL}${req.path}`;
  res.setHeader('Link', `<${canonical}>; rel="canonical"`);
  next();
});
```

---

## WARNING: Missing Static File Serving

**The Problem:** No `express.static` is configured. Any HTML, CSS, or JS assets
needed for a landing page would 404.

**Why This Breaks:**
1. Crawlers can't access page content — nothing to index
2. Social share scrapers get JSON errors, not Open Graph tags
3. Google Search Console shows 404 for submitted URLs

**The Fix:**

```javascript
// src/index.js — serve a /public directory for marketing assets
const path = require('path');
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '7d',
  etag: true,
}));
```

---

## Validation Checklist

Copy this checklist and track progress:
- [ ] `GET /robots.txt` returns 200 with `Disallow: /api/`
- [ ] `GET /sitemap.xml` returns 200 with valid XML
- [ ] All `/api/*` responses include `X-Robots-Tag: noindex, nofollow`
- [ ] `PUBLIC_URL` environment variable is set in Railway
- [ ] Google Search Console has been verified with DNS or HTML file method