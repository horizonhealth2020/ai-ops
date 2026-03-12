# In-App Guidance Reference

## Contents
- Guidance Surface in AI Ops
- Dashboard API as Guidance Delivery
- Writing Notes for Config-Driven Features
- DO / DON'T Patterns
- Guidance State Tracking

---

## Guidance Surface in AI Ops

AI Ops has no client-side React app — the dashboard consumes the API. "In-app guidance"
is delivered through the `GET /api/v1/dashboard/config` response. The dashboard client
reads setup state flags and renders appropriate prompts.

There is no tooltip system, modal framework, or in-app tour engine. Guidance = JSON fields
in the config response.

---

## Dashboard API as Guidance Delivery

When shipping a feature that requires client setup, add a boolean flag to the config response:

```javascript
// src/routes/dashboard.js — example guidance flag pattern
router.get('/config', requireClerk, async (req, res, next) => {
  try {
    const config = await getClientConfig(req.clientId);
    res.json({
      ...config,
      setup: {
        has_business_hours: config.business_hours !== null,
        has_faq_entries: config.faq_count > 0,
        has_fsm_connected: config.fsm_type !== null,
        wallet_funded: config.balance_cents > 0,
      }
    });
  } catch (err) {
    next(err);
  }
});
```

The dashboard client uses `setup.*` flags to show empty states, banners, or checklists.

---

## Writing Notes for Config-Driven Features

When a feature is config-driven, the release note must describe:
1. What the default behavior is (before client configures anything)
2. What the dashboard path is to configure it
3. What the API field is (for clients building custom dashboards)

```markdown
## Agent Persona Customization

The agent now uses a configurable name, greeting style, and voice persona.

**Default behavior:** Agent uses "Alex" as name with a neutral greeting.

**To customize:**
Dashboard → Agent Settings → Name, Greeting, Voice

**API:**
`PUT /api/v1/dashboard/agent` accepts:
```json
{
  "agent_name": "Sarah",
  "greeting_style": "friendly",
  "voice_id": "en-US-Neural2-F"
}
```
`GET /api/v1/dashboard/config` returns current values under `agent_config`.
```

---

## Guidance State Tracking in PostgreSQL

Setup milestones that drive guidance flags are stored in the `clients` table or derived
from related tables:

```sql
-- Check if client has completed key setup steps
SELECT
  c.client_id,
  c.business_hours IS NOT NULL AS has_hours,
  COUNT(f.faq_id) > 0 AS has_faqs,
  ci.integration_type IS NOT NULL AS has_fsm,
  w.balance_cents > 0 AS wallet_funded
FROM clients c
LEFT JOIN client_faqs f ON f.client_id = c.client_id
LEFT JOIN client_integrations ci ON ci.client_id = c.client_id AND ci.integration_type = 'fsm'
LEFT JOIN client_wallets w ON w.client_id = c.client_id
WHERE c.client_id = $1
GROUP BY c.client_id, c.business_hours, ci.integration_type, w.balance_cents;
```

When adding a new setup milestone, add it to this query and include it in the config response.

---

## DO / DON'T Patterns

**DO** — Document the default state explicitly:
```markdown
// GOOD — client knows what happens before they configure anything
Default: agent uses a generic greeting. No action needed to receive calls.
```

**DON'T** — Assume clients know the default:
```markdown
// BAD — client is confused about whether they need to do something
Agent greeting customization is now available.
```

**DO** — Show the exact JSON shape when the feature changes the API contract:
```markdown
// GOOD — API consumers know exactly what changed
GET /api/v1/dashboard/config now includes:
{
  "setup": {
    "has_faq_entries": true,
    "faq_count": 12
  }
}
```

**DON'T** — Reference UI paths without also providing API fields:
```markdown
// BAD — API-first clients are left out
Go to Dashboard → Knowledge Base to manage FAQ entries.
```

**DO** — Explain when guidance flags become true:
```markdown
// GOOD — client knows what triggers the flag to clear
`setup.has_fsm_connected` becomes `true` after completing OAuth in Dashboard → Integrations.
```

---

## In-App Guidance Release Note Checklist

Copy this checklist when shipping a change that affects client setup or guidance:

- [ ] Document the `setup.*` flag added to `GET /api/v1/dashboard/config`
- [ ] State the default behavior (what happens with zero configuration)
- [ ] Include the Dashboard path for configuration
- [ ] Include the API field name and type
- [ ] Note which PostgreSQL table/column stores the setup state
- [ ] Describe what triggers the setup flag to become `true`

See the **designing-inapp-guidance** skill for adding setup checklist fields to dashboard endpoints.
See the **mapping-user-journeys** skill for tracing the client path through setup steps.
