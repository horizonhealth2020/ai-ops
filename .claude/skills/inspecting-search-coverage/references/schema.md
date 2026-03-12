# Structured Data (Schema.org) Reference

## Contents
- SaaS product schema
- LocalBusiness schema for client verticals
- FAQ schema for support content
- Service schema for booking pages
- WARNING: No JSON-LD injection layer

See the **adding-structured-signals** skill for detailed JSON-LD implementation patterns.

---

## SaaS Product Schema

Add `SoftwareApplication` schema to the homepage:

```javascript
// src/utils/schema.js
'use strict';

function softwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    'name': 'AI Ops',
    'applicationCategory': 'BusinessApplication',
    'operatingSystem': 'Web',
    'description': 'Multi-tenant AI voice agent SaaS for blue-collar service businesses. Handles inbound calls, appointment booking, and payments.',
    'offers': [
      {
        '@type': 'Offer',
        'name': 'Standard',
        'price': '0.40',
        'priceCurrency': 'USD',
        'description': 'Per minute of AI call handling',
      },
      {
        '@type': 'Offer',
        'name': 'Growth',
        'price': '0.32',
        'priceCurrency': 'USD',
        'description': 'Per minute — Growth tier',
      },
      {
        '@type': 'Offer',
        'name': 'Scale',
        'price': '0.27',
        'priceCurrency': 'USD',
        'description': 'Per minute — Scale tier',
      },
      {
        '@type': 'Offer',
        'name': 'Enterprise',
        'price': '0.23',
        'priceCurrency': 'USD',
        'description': 'Per minute — Enterprise tier',
      },
    ],
  };
}

module.exports = { softwareApplicationSchema };
```

---

## LocalBusiness Schema for Vertical Landing Pages

When rendering a vertical+location page, inject schema for the *category* of business:

```javascript
// src/utils/schema.js
function localBusinessCategorySchema({ vertical, location, displayName }) {
  const typeMap = {
    hvac: 'HVACBusiness',
    plumbing: 'Plumber',
    electrical: 'Electrician',
    spa: 'DaySpa',
    cleaning: 'HousePainter', // closest schema.org type
    restaurant: 'Restaurant',
  };

  return {
    '@context': 'https://schema.org',
    '@type': typeMap[vertical] || 'LocalBusiness',
    'name': `AI-Powered ${displayName} Answering Service`,
    'description': `AI Ops handles inbound calls for ${displayName} businesses in ${location}.`,
    'areaServed': location,
  };
}

module.exports = { softwareApplicationSchema, localBusinessCategorySchema };
```

---

## FAQ Schema for Support Content

If FAQ content is added to the site (pulled from `client_faqs` via pgvector):

```javascript
// src/utils/schema.js
function faqSchema(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': faqs.map(faq => ({
      '@type': 'Question',
      'name': faq.question,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': faq.answer,
      },
    })),
  };
}

module.exports = { softwareApplicationSchema, localBusinessCategorySchema, faqSchema };
```

---

## Injecting JSON-LD into HTML Responses

```javascript
// src/utils/htmlHelpers.js
function injectSchema(schemaObject) {
  return `<script type="application/ld+json">
${JSON.stringify(schemaObject, null, 2)}
</script>`;
}

// Usage in a route:
const { softwareApplicationSchema } = require('../utils/schema');
const { injectSchema } = require('../utils/htmlHelpers');

router.get('/', (req, res) => {
  const schema = injectSchema(softwareApplicationSchema());
  res.send(`<!DOCTYPE html><html><head>${schema}</head><body>...</body></html>`);
});
```

---

## WARNING: No JSON-LD Injection Layer

**The Problem:** No templating engine means no standard location to inject schema.

**Why This Breaks:**
1. Rich results (FAQ dropdowns, pricing in SERPs) require valid JSON-LD
2. Hand-building HTML strings with schema is error-prone
3. Schema omitted from error pages, which are sometimes indexed

**The Fix:** Add a minimal templating utility:

```javascript
// src/utils/renderPage.js
'use strict';
function renderPage({ head = '', body = '', schemas = [] }) {
  const schemaBlocks = schemas
    .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${head}
  ${schemaBlocks}
</head>
<body>${body}</body>
</html>`;
}
module.exports = { renderPage };
```

---

## Validation

```bash
# Test schema output locally
curl -s http://localhost:3000/ | grep -A 50 'application/ld+json'

# Pipe to jq for readability
curl -s http://localhost:3000/ | grep -o '{.*}' | jq .
```

Use Google's Rich Results Test tool with your Railway URL to verify schema eligibility.