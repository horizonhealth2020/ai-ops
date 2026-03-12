# Product Analytics Reference

## Contents
- Analytics Sources in AI Ops
- Querying Call and Booking Data
- Metric-Backed Release Notes
- DO / DON'T Patterns
- Post-Release Validation Queries

---

## Analytics Sources in AI Ops

AI Ops has no dedicated analytics service. Metrics come from two tables:

| Table | What it tracks |
|-------|---------------|
| `call_logs` | Every inbound call: duration, outcome, client_id, caller phone |
| `bookings` | Every confirmed appointment: service, date, client_id, fsm_job_id |
| `payment_transactions` | Every payment intent: amount_cents, processor, status |
| `client_wallets` | Balance snapshots and top-up history |

These are the only authoritative sources. When writing a metric-backed note, query these tables.

---

## Querying Call and Booking Data

```javascript
// Booking conversion rate per client (calls that resulted in a booking)
const result = await pool.query(
  `SELECT
     c.client_id,
     COUNT(cl.call_id) AS total_calls,
     COUNT(b.booking_id) AS total_bookings,
     ROUND(COUNT(b.booking_id)::numeric / NULLIF(COUNT(cl.call_id), 0) * 100, 1) AS conversion_pct
   FROM clients c
   LEFT JOIN call_logs cl ON cl.client_id = c.client_id
   LEFT JOIN bookings b ON b.client_id = c.client_id
     AND b.created_at >= cl.created_at - INTERVAL '10 minutes'
     AND b.created_at <= cl.created_at + INTERVAL '10 minutes'
   WHERE c.is_active = true
   GROUP BY c.client_id`,
  []
);
```

```javascript
// Average call duration by vertical
const result = await pool.query(
  `SELECT
     c.vertical,
     ROUND(AVG(cl.duration_seconds), 0) AS avg_duration_seconds
   FROM call_logs cl
   JOIN clients c ON c.client_id = cl.client_id
   WHERE cl.created_at >= NOW() - INTERVAL '30 days'
   GROUP BY c.vertical
   ORDER BY avg_duration_seconds DESC`,
  []
);
```

---

## Metric-Backed Release Notes

When a feature change has measurable impact, include the signal in the note. Derive it from
the tables above — never fabricate numbers.

```markdown
## Booking Confirmation Rate Improvement

After the FSM retry logic fix in `bookingService.js`, confirmed bookings increased from
71% to 89% for clients using HouseCall Pro (measured over 30 days post-deploy).

**What changed:** Failed FSM verifications now retry once after 500ms before returning
fallback alternatives. The original implementation failed permanently on transient 503s.

Affects: HouseCall Pro, Jobber. ServiceTitan uses OAuth token refresh, not affected.
```

---

## Surfacing Metrics in the Dashboard API

The `GET /api/v1/dashboard/calls` endpoint returns paginated call data. When adding
filterable analytics, add query params rather than new endpoints:

```javascript
// src/routes/dashboard.js — call log filters
router.get('/calls', requireClerk, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, outcome, from_date, to_date } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT * FROM call_logs
       WHERE client_id = $1
         AND ($2::text IS NULL OR outcome = $2)
         AND ($3::date IS NULL OR created_at::date >= $3)
         AND ($4::date IS NULL OR created_at::date <= $4)
       ORDER BY created_at DESC
       LIMIT $5 OFFSET $6`,
      [req.clientId, outcome || null, from_date || null, to_date || null, limit, offset]
    );
    res.json({ calls: result.rows, page: +page, limit: +limit });
  } catch (err) {
    next(err);
  }
});
```

When shipping new filter params, the release note must document them:

```markdown
## Call Log Filters: Date Range + Outcome

`GET /api/v1/dashboard/calls` now accepts:
- `from_date` (YYYY-MM-DD) — earliest call date
- `to_date` (YYYY-MM-DD) — latest call date
- `outcome` — one of: `booked`, `transferred`, `voicemail`, `abandoned`

All params are optional. Omit to return all calls paginated.
```

---

## DO / DON'T Patterns

**DO** — Ground metrics in specific table queries:
```markdown
// GOOD — auditable claim
Based on `call_logs` data over the prior 30 days: average call duration dropped from 4m12s
to 3m08s after adding FAQ context injection.
```

**DON'T** — Use vague or fabricated metrics:
```markdown
// BAD — cannot be verified
Users are spending significantly less time on calls thanks to this improvement.
```

**DO** — Note the measurement window:
```markdown
// GOOD
Measured over 2,400 calls across 14 active clients in the 30 days following deployment.
```

**DON'T** — Omit sample size or time window:
```markdown
// BAD — statistically meaningless
Booking rate improved by 12%.
```

---

## Post-Release Validation Queries

Run these after deploying a feature that affects call or booking behavior:

```sql
-- 1. Confirm feature is being invoked (check call_logs for new outcome values)
SELECT outcome, COUNT(*) FROM call_logs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY outcome;

-- 2. Check booking success rate hasn't regressed
SELECT
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
  COUNT(*) AS total,
  ROUND(COUNT(*) FILTER (WHERE status = 'confirmed')::numeric / COUNT(*) * 100, 1) AS pct
FROM bookings
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 1;

-- 3. Verify wallet deductions are correct post billing-tier change
SELECT tier, AVG(amount_cents) AS avg_deduction
FROM wallet_transactions
WHERE created_at >= NOW() - INTERVAL '48 hours'
GROUP BY tier;
```

Include the relevant query in the release note when shipping billing or booking logic changes.

See the **instrumenting-product-metrics** skill for adding structured event tracking.
See the **postgresql** skill for migration patterns when adding new analytics columns.
