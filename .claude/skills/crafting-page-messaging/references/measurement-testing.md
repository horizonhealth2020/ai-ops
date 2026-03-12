# Measurement & Testing Reference

## Contents
- What to measure
- Logging copy experiment signals
- A/B testing agent scripts
- Validating copy via call logs
- Anti-patterns

---

## What to Measure

Copy quality in AI Ops is measured through call outcomes, not page views. The relevant
signals are in `call_logs` (PostgreSQL) after `POST /api/v1/call/complete` fires.

| Signal | Column | What It Tells You |
|--------|--------|-------------------|
| Booking rate | `outcome = 'booked'` | Primary conversion — script is working |
| Message-taken rate | `outcome = 'message_taken'` | Soft fallback — acceptable but not great |
| Abandoned rate | `outcome = 'abandoned'` | Caller hung up — copy failed or flow broke |
| Wallet soft-lock exits | `outcome = 'message_taken' AND wallet_triggered = true` | Soft-lock copy quality |
| Transfer rate | `outcome = 'transferred'` | Caller needed human — agent couldn't close |

---

## Logging Copy Experiment Signals (src/routes/call.js)

When testing two versions of a script, log which variant was active in the call log.

```javascript
// src/routes/call.js — POST /api/v1/call/complete
router.post('/complete', requireVapiAuth, async (req, res, next) => {
  try {
    const { call_id, duration_seconds, outcome, script_variant } = req.body;

    await pool.query(
      `INSERT INTO call_logs
       (client_id, call_id, duration_seconds, outcome, script_variant, ended_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [clientId, call_id, duration_seconds, outcome, script_variant || 'control']
    );

    logger.info('Call complete', { client_id: clientId, outcome, script_variant });
    res.json({ success: true });
  } catch (err) { next(err); }
});
```

The `script_variant` field enables per-variant outcome queries without a separate analytics
service. See the **instrumenting-product-metrics** skill for event logging patterns.

---

## A/B Testing Agent Scripts

Script variants are compiled into the system prompt at config time. Use a feature flag
stored per-client in PostgreSQL.

```javascript
// src/services/promptCompiler.js
async function compile(clientId) {
  const client = await getClientConfig(clientId);

  // Variant flag drives which rejection script is used
  const rejectionScript = client.ab_variant === 'v2_alternatives'
    ? buildV2RejectionScript(client)
    : buildControlRejectionScript(client);

  return assemblePrompt({ ...client, rejectionScript });
}
```

```sql
-- Enable variant for a single client
UPDATE clients SET ab_variant = 'v2_alternatives' WHERE client_id = $1;
```

Query results after sufficient call volume (minimum 100 calls per variant):

```sql
SELECT
  script_variant,
  COUNT(*) AS total_calls,
  COUNT(*) FILTER (WHERE outcome = 'booked') AS bookings,
  ROUND(COUNT(*) FILTER (WHERE outcome = 'booked')::numeric / COUNT(*) * 100, 1) AS booking_rate_pct
FROM call_logs
WHERE client_id = $1
  AND ended_at > NOW() - INTERVAL '14 days'
GROUP BY script_variant;
```

---

## Validating Copy via Call Logs (src/routes/dashboard.js)

Operators can see call outcomes in `GET /api/v1/dashboard/calls`. Surface copy-relevant
signals in the response so operators notice when scripts underperform.

```javascript
// Aggregate outcomes for the dashboard — expose actionable signals
const stats = await pool.query(
  `SELECT
     outcome,
     COUNT(*) as count,
     ROUND(AVG(duration_seconds)) as avg_duration
   FROM call_logs
   WHERE client_id = $1 AND ended_at > NOW() - INTERVAL '7 days'
   GROUP BY outcome`,
  [clientId]
);

// Surface a warning if abandoned rate > 20%
const abandonedRate = stats.rows.find(r => r.outcome === 'abandoned')?.count / totalCalls;
const copyWarning = abandonedRate > 0.2
  ? "More than 20% of calls are ending without a booking or message. " +
    "Consider reviewing your agent script in Settings."
  : null;
```

---

## WARNING: Measuring Copy Quality with Duration Alone

**The Problem:**
```javascript
// BAD — long calls aren't necessarily successful calls
const qualityScore = avgCallDuration > 120 ? 'good' : 'poor';
```

**Why This Breaks:**
1. A confused caller who stays on the line for 3 minutes before hanging up scores "good"
2. A clean booking that takes 45 seconds scores "poor"
3. Duration is a proxy metric — outcome is the ground truth

**The Fix:**
```javascript
// GOOD — outcome-driven quality, duration as secondary signal
const bookingRate = bookings / totalCalls;
const avgBookingDuration = await getAvgDuration({ outcome: 'booked' });
// Low booking rate + long avg duration = script confusion, not success
```

---

## Copy Test Checklist

- [ ] Add `script_variant` field to `call_logs` migration if not present
- [ ] Set `ab_variant` on pilot client(s) in PostgreSQL
- [ ] Log `script_variant` in `POST /api/v1/call/complete`
- [ ] Run for minimum 100 calls per variant before reading results
- [ ] Query booking rate by variant — not duration
- [ ] If variant wins: update `DEFAULT_*` constant and remove flag
- [ ] If variant loses: revert `ab_variant` to null (control)
