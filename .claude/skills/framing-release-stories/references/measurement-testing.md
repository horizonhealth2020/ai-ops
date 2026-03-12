# Measurement & Testing Reference

## Contents
- Release Success Metrics
- Call Log Data for Post-Launch Validation
- Wallet Metric as Adoption Signal
- A/B Testing Announcement Copy
- WARNING: Launching Without Baseline Metrics

---

## Release Success Metrics

Every release story needs a success signal defined before launch. Map the feature to a
measurable event in the platform's data:

| Feature Type | Primary Metric | Query target |
|--------------|---------------|--------------|
| New FSM integration | `client_integrations` rows created | `client_integrations` table |
| Booking improvement | Booking completion rate | `bookings` table |
| Wallet / billing change | Avg wallet top-up amount | `wallet_transactions` table |
| Agent persona update | Dashboard config PUT rate | `call_logs` + timing |
| New vertical support | `clients.vertical` distribution | `clients` table |
| FAQ / pgvector search | FAQ match rate in call logs | `call_logs.metadata` |

---

## Call Log Data for Post-Launch Validation

`GET /api/v1/dashboard/calls` returns paginated call logs. Post-launch, query this endpoint
to measure agent behavior changes tied to the release.

```javascript
// Validate booking improvement release:
// Compare booking_confirmed rate before vs. after deploy date
const result = await pool.query(
  `SELECT
     DATE_TRUNC('day', started_at) AS day,
     COUNT(*) AS total_calls,
     COUNT(*) FILTER (WHERE outcome = 'booking_confirmed') AS bookings
   FROM call_logs
   WHERE client_id = $1
     AND started_at >= $2
   GROUP BY day
   ORDER BY day`,
  [clientId, releaseDate]
);
```

```javascript
// Validate FSM integration adoption:
// Count clients who connected FSM integration after launch date
const result = await pool.query(
  `SELECT COUNT(DISTINCT client_id) AS connected
   FROM client_integrations
   WHERE integration_type = 'fsm'
     AND created_at >= $1`,
  [releaseDate]
);
```

---

## Wallet Metric as Adoption Signal

Wallet top-up is the clearest proxy for "client believes the agent is delivering value."
Track top-up frequency and average amount pre/post release to gauge whether announcements
are driving retention or upgrade behavior.

```javascript
// wallet_transactions query — top-up events post-release
const result = await pool.query(
  `SELECT
     client_id,
     SUM(amount_cents) / 100.0 AS total_topped_up,
     COUNT(*) AS top_up_count
   FROM wallet_transactions
   WHERE transaction_type = 'credit'
     AND created_at >= $1
   GROUP BY client_id
   ORDER BY total_topped_up DESC`,
  [releaseDate]
);
```

**Healthy signal:** Top-up count increases within 2 weeks of a billing-tier announcement.
**Warning signal:** No increase in top-ups after a "wallet now easier" release → copy failed.

---

## A/B Testing Announcement Copy

No A/B testing library exists in the stack. Use client segmentation as a proxy for copy tests.

```javascript
// Segment by vertical to test different copy angles
// Variant A: outcome-first ("Your agent now books faster")
// Variant B: feature-first ("New booking confirmation flow")
// Measure: FSM connection rate within 7 days per segment

const hvacClients = await pool.query(
  "SELECT client_id, phone FROM clients WHERE vertical = 'hvac' AND is_active = true"
);

const spaClients = await pool.query(
  "SELECT client_id, phone FROM clients WHERE vertical = 'spa' AND is_active = true"
);

// Send variant A to HVAC, variant B to spa
// Compare FSM connect rate at T+7 days
```

**Measurement checklist for copy test:**
- [ ] Define one measurable success event (FSM connect, wallet top-up, config PUT)
- [ ] Segment clients into two non-overlapping groups
- [ ] Send variant A to group 1, variant B to group 2 via SMS
- [ ] Query success event count at T+7 and T+14 days
- [ ] Declare winner and use winning copy in next release

---

## WARNING: Launching Without Baseline Metrics

**The Problem:**

```javascript
// BAD — shipping a release and checking metrics after
// "Let's see if bookings go up this month"
```

**Why This Breaks:**
1. Without a pre-launch baseline, you cannot attribute changes to the release
2. Seasonal variation in call volume (spa = summer peak, HVAC = summer + winter) contaminates
   attribution unless you have a pre-period baseline from the same week last month/year
3. You can't write a post-launch "success story" without numbers to cite

**The Fix:**

```javascript
// GOOD — capture baseline 7 days before release
// Run this query BEFORE deploying, save the result
const baseline = await pool.query(
  `SELECT
     COUNT(*) AS total_calls,
     COUNT(*) FILTER (WHERE outcome = 'booking_confirmed') AS bookings,
     AVG(duration_seconds) AS avg_duration
   FROM call_logs
   WHERE created_at >= NOW() - INTERVAL '7 days'`
);

// After release, compare against the same metric
// Post-launch rate vs. baseline rate = the story
```

**Pre-launch measurement checklist:**
- [ ] Step 1: Run baseline query 7 days before release date, save output
- [ ] Step 2: Deploy release
- [ ] Step 3: At T+7 post-launch, run same query for matching 7-day window
- [ ] Step 4: Compute delta — use this in post-launch comms
- [ ] Step 5: If no delta, check adoption (did clients actually use the feature?)

See the **instrumenting-product-metrics** skill for event tracking patterns.
See the **triaging-user-feedback** skill for classifying qualitative signals post-launch.
