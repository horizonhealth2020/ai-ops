# Competitive SEO Reference

## Contents
- Competitor landscape for AI voice agent SaaS
- Comparison page strategy
- Alternative page strategy
- SERP feature targeting
- Internal linking for competitive keywords

---

## Competitor Landscape

AI Ops competes in the AI answering service and field service automation space.
Key competitors by vertical:

| Competitor | Category | Their Strengths |
|------------|----------|----------------|
| Ruby Receptionist | Live + AI answering | Brand recognition, broad SMB |
| AnswerConnect | Virtual receptionist | Price anchoring, legacy SEO |
| Vapi (direct) | AI voice platform | Developer-facing, no vertical focus |
| Jobber | FSM with booking | Existing FSM customer base |
| HouseCall Pro | FSM with booking | HVAC/plumbing dominant |
| Yelp/Thumbtack | Lead gen | High-intent SERP presence |

AI Ops differentiator: the only solution that integrates AI call handling
*and* FSM booking *and* payment collection in one product, purpose-built for
blue-collar field service businesses.

---

## Comparison Page Pattern

Target high-intent "X vs Y" searches with dedicated comparison pages:

```javascript
// src/routes/compare.js
'use strict';
const router = require('express').Router();
const { renderPage } = require('../utils/renderPage');
const { buildHead } = require('../utils/htmlHelpers');

const COMPARISONS = {
  'vs-ruby-receptionist': {
    title: 'AI Ops vs Ruby Receptionist — Which Is Right for HVAC & Plumbing?',
    description: 'Compare AI Ops and Ruby Receptionist for field service call handling. AI Ops books directly into HouseCall Pro and collects payments automatically.',
    competitor: 'Ruby Receptionist',
  },
  'vs-answerconnect': {
    title: 'AI Ops vs AnswerConnect for Field Service Businesses',
    description: 'AnswerConnect uses live agents. AI Ops uses AI that books appointments and takes payments without human intervention.',
    competitor: 'AnswerConnect',
  },
};

router.get('/compare/:slug', (req, res, next) => {
  const page = COMPARISONS[req.params.slug];
  if (!page) return next();
  const head = buildHead({
    title: page.title,
    description: page.description,
    canonicalUrl: `${process.env.PUBLIC_URL}/compare/${req.params.slug}`,
  });
  res.send(renderPage({ head, body: `<!-- ${page.competitor} comparison content -->` }));
});

module.exports = router;
```

---

## Alternative Page Pattern

Target "[competitor] alternative" searches — high commercial intent:

```javascript
// Route: /alternatives/ruby-receptionist
// Route: /alternatives/answerconnect

const ALTERNATIVES = {
  'ruby-receptionist': {
    title: 'Best Ruby Receptionist Alternative for HVAC & Service Companies',
    description: 'Looking for a Ruby Receptionist alternative that actually books appointments? AI Ops integrates with HouseCall Pro, Jobber, and ServiceTitan.',
    targetVerticals: ['hvac', 'plumbing', 'electrical'],
  },
};
```

**Content requirements for alternative pages to rank:**
1. Specific feature comparison table (not vague claims)
2. Pricing comparison using real numbers (see wallet tiers in README)
3. Use-case differentiation — when to choose each option
4. Social proof from actual verticals served

---

## SERP Feature Targeting

| Feature | How to Earn It | Implementation |
|---------|---------------|----------------|
| FAQ rich results | FAQ schema on support pages | See **schema** reference |
| Pricing rich results | `Offer` schema on pricing page | See **adding-structured-signals** skill |
| Sitelinks | Strong homepage authority + internal linking | Clear nav structure |
| Review snippets | `AggregateRating` schema | Requires real review data |

---

## WARNING: Competing on Generic Terms

**The Problem:**

```
// BAD targeting — impossible to rank
Title: "AI Voice Agent"
// Competing against OpenAI, Google, every major tech company
```

**Why This Breaks:**
1. Domain authority of AI Ops cannot compete with enterprise tech brands on generic terms
2. Generic visitors have low conversion intent — they want research, not a SaaS product
3. Wasted crawl budget on pages that will never rank

**The Fix:** Long-tail, vertical-specific keywords:

```
// GOOD — narrow intent, lower competition, higher conversion
Title: "AI Phone Agent for HVAC Companies — Books Into HouseCall Pro"
Target: "hvac company answering service ai"
Target: "automated booking hvac business"
```

---

## Internal Linking for Competitive Keywords

Link from high-authority pages to comparison and alternative pages:

```javascript
// In homepage HTML
const competitiveLinks = [
  { href: '/compare/vs-ruby-receptionist', text: 'AI Ops vs Ruby Receptionist' },
  { href: '/alternatives/answerconnect', text: 'AnswerConnect Alternative' },
];
// Render as text links in footer or "How We Compare" section
```

Anchor text must be descriptive and keyword-rich. NEVER use "click here" or "learn more"
as anchor text for competitive pages — you're throwing away the link equity signal.

---

## Monitoring Competitive Position

```bash
# Check if comparison pages are indexed
curl "https://www.google.com/search?q=site:YOUR_DOMAIN+compare"

# Check ranking for target keywords (use a real rank tracker in production)
# Tools: Ahrefs, SEMrush, Google Search Console Performance report
```

See the **instrumenting-product-metrics** skill for tracking organic traffic conversion
alongside product activation metrics.