# Product Analytics Reference

## Contents
- Guidance event logging pattern
- Structured log schema for guidance events
- Querying activation funnel from call_logs
- Checklist completion rate query
- Anti-patterns

---

## Guidance Event Logging

Log guidance events as structured JSON using `src/utils/logger.js`. There is no separate analytics service — events are structured log lines queryable via Railway log aggregation or forwarded via n8n.

```javascript
// src/utils/logger.js usage for guidance events
const logger = require('../utils/logger');

// When a nudge is surfaced
logger.info('guidance_nudge_surfaced', {
  client_id: clientId,
  nudge_type: nudge.type,
  nudge_severity: nudge.severity,
  surface: 'dashboard_wallet',
});

// When onboarding step completes
logger.info('guidance_step_completed', {
  client_id: clientId,
  step_id: 'fsm_connected',
  completed_at: new Date().toISOString(),
});

// When all onboarding complete
logger.info('guidance_onboard_complete', {
  client_id: clientId,
  time_to_complete_ms: Date.now() - onboardStartedAt,
});
```

## Activation Funnel Query

Derive activation funnel from existing tables — no separate events table required.

```sql
-- Activation funnel: clients by stage
SELECT
  COUNT(*)                                                    AS total_clients,
  COUNT(*) FILTER (WHERE system_prompt IS NOT NULL)           AS prompt_configured,
  COUNT(*) FILTER (WHERE ci.client_id IS NOT NULL)            AS fsm_connected,
  COUNT(*) FILTER (WHERE cw.balance_cents > 0)                AS wallet_funded,
  COUNT(*) FILTER (WHERE cl.call_count > 0)                   AS first_call_received
FROM clients c
LEFT JOIN (
  SELECT DISTINCT client_id FROM client_integrations WHERE integration_type = 'fsm'
) ci ON ci.client_id = c.client_id
LEFT JOIN client_wallets cw ON cw.client_id = c.client_id
LEFT JOIN (
  SELECT client_id, COUNT(*) AS call_count FROM call_logs GROUP BY client_id
) cl ON cl.client_id = c.client_id
WHERE c.is_active = true;
```

## Checklist Completion Rate Query

```sql
-- Per-step completion rate across all active clients
SELECT
  ROUND(100.0 * COUNT(*) FILTER (WHERE system_prompt IS NOT NULL) / COUNT(*), 1) AS pct_prompt,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ci.client_id IS NOT NULL) / COUNT(*), 1) AS pct_fsm,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cw.balance_cents > 0) / COUNT(*), 1)     AS pct_wallet
FROM clients c
LEFT JOIN (SELECT DISTINCT client_id FROM client_integrations WHERE integration_type = 'fsm') ci
  ON ci.client_id = c.client_id
LEFT JOIN client_wallets cw ON cw.client_id = c.client_id
WHERE c.is_active = true;
```

## n8n Webhook for Analytics Events

For events that need downstream processing (CRM update, email trigger), fire an n8n webhook asynchronously. Never await this in the request path.

```javascript
// src/services/guidanceService.js
const axios = require('axios');

function fireGuidanceEventAsync(eventName, payload) {
  // Fire-and-forget — never block the request path
  axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/guidance-event`, {
    event: eventName,
    ...payload,
    fired_at: new Date().toISOString(),
  }).catch((err) => {
    logger.warn('Guidance event webhook failed', { event: eventName, error: err.message });
  });
}

// Usage
fireGuidanceEventAsync('onboard_complete', { client_id: clientId });
```

## DO / DON'T

**DO** use structured log fields (`client_id`, `nudge_type`, `step_id`) — not interpolated strings.
**DON'T** log `logger.info('nudge shown for ' + clientId)` — that's unsearchable and leaks to plaintext logs.

**DO** fire analytics events fire-and-forget via `fireGuidanceEventAsync`.
**DON'T** await n8n webhooks in the request path — a slow n8n instance will delay every dashboard load.

**DO** derive funnel metrics from existing tables (clients, call_logs, client_wallets).
**DON'T** create a separate `analytics_events` table for guidance events unless query complexity demands it.

## WARNING: Missing professional analytics solution

**Detected:** No dedicated analytics library (PostHog, Mixpanel, Amplitude) in `package.json`.
**Impact:** Funnel analysis requires manual SQL queries; no cohort or retention analysis out of the box.

If product analytics depth grows, add PostHog Node.js SDK:
```bash
npm install posthog-node
```
```javascript
const { PostHog } = require('posthog-node');
const posthog = new PostHog(process.env.POSTHOG_API_KEY);
posthog.capture({ distinctId: clientId, event: 'guidance_step_completed', properties: { step_id } });
```

See the **instrumenting-product-metrics** skill for event taxonomy. See the **node** skill for fire-and-forget async patterns.
