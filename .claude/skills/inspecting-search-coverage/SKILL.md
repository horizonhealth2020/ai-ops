---
name: inspecting-search-coverage
description: |
  Audits technical and on-page search coverage for the AI Ops platform. Covers
  public API surface indexability, structured data for the SaaS offering, and
  SEO concerns for any marketing or client-facing pages served alongside this backend.
  Use when: auditing what search engines can index from this backend, adding structured
  data to public routes, diagnosing missing metadata on any server-rendered HTML,
  assessing robots/sitemap coverage, or evaluating how the onboarding and health
  endpoints appear to crawlers.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Inspecting-search-coverage Skill

This is a Node.js/Express backend with no server-rendered marketing pages — search
coverage concerns are narrow but real. The public surface is `/api/v1/onboard` (intake
form target), `/health`, and any HTML responses from error handlers. If a marketing
site or dashboard frontend is added, SEO scope expands significantly. For now, the
primary SEO work is structured data for the SaaS platform, robots directives for
API routes, and ensuring the onboarding endpoint returns machine-readable signals
search tools can follow.

## Quick Start

### Check what Express is serving to crawlers

```bash
# Does the server respond to user-agent: Googlebot?
curl -A "Googlebot" https://YOUR_RAILWAY_URL/health
curl -A "Googlebot" https://YOUR_RAILWAY_URL/api/v1/onboard
```

### Verify robots.txt exists

```bash
curl https://YOUR_RAILWAY_URL/robots.txt
# Should return rules, not 404
```

### Add robots.txt as a static route

```javascript
// src/routes/seo.js
'use strict';
const router = require('express').Router();

router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Disallow: /api/',
    'Allow: /',
    `Sitemap: ${process.env.PUBLIC_URL}/sitemap.xml`,
  ].join('\n'));
});

module.exports = router;
```

## Key Concepts

| Concept | Usage | Example |
|---------|-------|---------|
| robots.txt | Block API routes from crawlers | `Disallow: /api/` |
| Structured data | Describe the SaaS platform | JSON-LD in any HTML response |
| Canonical URL | Prevent duplicate indexing | `rel="canonical"` header |
| Open Graph | Social sharing previews | `og:title` meta tags |
| Sitemap | Declare indexable URLs | `/sitemap.xml` route |

## Common Patterns

### Blocking API routes while allowing public pages

**When:** You add a landing page or documentation to this Express server.

```javascript
// robots.txt — block all /api/* but allow root and docs
User-agent: *
Disallow: /api/
Allow: /docs/
Allow: /
```

### Adding X-Robots-Tag header to API responses

**When:** You want to ensure API JSON responses are never indexed even if crawled.

```javascript
// src/middleware/noIndex.js
'use strict';
module.exports = function noIndex(req, res, next) {
  if (req.path.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
};
```

## See Also

- [technical](references/technical.md)
- [on-page](references/on-page.md)
- [content](references/content.md)
- [programmatic](references/programmatic.md)
- [schema](references/schema.md)
- [competitive](references/competitive.md)

## Related Skills

- See the **adding-structured-signals** skill for JSON-LD implementation
- See the **crafting-page-messaging** skill for on-page copy that targets keywords
- See the **tuning-landing-journeys** skill for landing page conversion + SEO alignment
- See the **express** skill for route and middleware patterns used here
- See the **node** skill for static file serving and environment variable patterns