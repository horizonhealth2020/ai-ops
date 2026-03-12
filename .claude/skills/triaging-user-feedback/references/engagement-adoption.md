# Engagement & Adoption Reference

## Contents
- Call outcome as engagement signal
- Dashboard feature adoption
- Wallet reload as retention signal
- FSM integration depth
- DO/DON'T pairs

## Call Outcome as Engagement Signal

The primary engagement metric for this platform is call outcome. Clients who see `booking_confirmed` outcomes retain; those stuck on `transfer_required` or `failed` churn.

```javascript
// Triage: pull 30-day outcome distribution per client
const { rows } = await pool.query(
  `SELECT outcome, COUNT(*) AS count
   FROM call_logs
   WHERE client_id = $1
     AND created_at > NOW() - INTERVAL '30 days'
   GROUP BY outcome`,
  [clientId]
);
// High 'transfer_required' → agent can't resolve → backlog (expand agent capabilities)
// High 'failed' → booking or payment errors → quick wins (fix error paths)
// High 'booking_confirmed' → healthy adoption
```

## Dashboard Feature Adoption

Track which dashboard endpoints are being called per tenant. Low `PUT /api/v1/dashboard/agent` usage means clients aren't customizing their agent — an adoption gap, not a code bug.

```javascript
// Add to src/middleware/auth.js or a dedicated analytics middleware
function trackDashboardUsage(req, res, next) {
  logger.info('dashboard_endpoint_used', {
    client_id: req.auth?.clientId,
    method: req.method,
    path: req.path,
  });
  next();
}
// Wire to router: dashboardRouter.use(trackDashboardUsage)
```

## Wallet Reload as Retention Signal

A client who reloads their wallet is retained. A client whose balance hits zero and never reloads has churned silently.

```javascript
// Detect silent churn risk: balance zero + no reload in 14 days
const { rows } = await pool.query(
  `SELECT w.client_id, w.balance_cents,
          MAX(t.created_at) AS last_reload
   FROM client_wallets w
   LEFT JOIN wallet_transactions t
     ON t.client_id = w.client_id AND t.type = 'reload'
   WHERE w.balance_cents = 0
   GROUP BY w.client_id, w.balance_cents
   HAVING MAX(t.created_at) < NOW() - INTERVAL '14 days'
      OR MAX(t.created_at) IS NULL`,
  []
);
// These clients need an n8n re-engagement webhook, not a bug fix
```

## FSM Integration Depth

Clients with a connected FSM (HouseCall Pro, Jobber, ServiceTitan) have 3x higher booking confirmation rates. Low FSM adoption is a product adoption gap.

```javascript
// Triage: which clients have no FSM integration stored?
const { rows } = await pool.query(
  `SELECT c.client_id, c.company_name
   FROM clients c
   LEFT JOIN client_integrations i
     ON i.client_id = c.client_id AND i.integration_type = 'fsm'
   WHERE i.client_id IS NULL AND c.is_active = true`,
  []
);
// These clients need in-dashboard nudge, not a code fix
```

See the **orchestrating-feature-adoption** skill for nudge sequencing strategies.

## DO/DON'T Pairs

**DO** separate engagement gaps (client not using a feature) from product bugs (feature broken).

**DON'T** create backlog items for low FSM adoption — it's a go-to-market problem, not an engineering one.

**DO** use `call_logs.outcome` as the ground truth for engagement health. Don't rely on self-reported client feedback alone.

**DON'T** add new dashboard features to improve adoption without first checking if existing features are discoverable. See the **mapping-user-journeys** skill.

```javascript
// GOOD — correlate feedback to actual usage before building
const { rows } = await pool.query(
  `SELECT COUNT(*) FROM call_logs
   WHERE client_id = $1 AND outcome = 'booking_confirmed'
     AND created_at > NOW() - INTERVAL '7 days'`,
  [clientId]
);
// If count > 0, client IS using booking successfully — their complaint is edge-case, not systemic
```
