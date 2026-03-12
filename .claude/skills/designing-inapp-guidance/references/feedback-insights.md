# Feedback & Insights Reference

## Contents
- Call transcript as feedback signal
- Wallet churn signal
- Dashboard config change as intent signal
- n8n post-call feedback webhook
- Support signal patterns
- Anti-patterns

---

## Call Transcript as Feedback Signal

Call logs in PostgreSQL contain transcript excerpts. Mine these for common caller questions to surface in the agent's FAQ or to trigger operator nudges.

```javascript
// src/routes/dashboard.js
// GET /api/v1/dashboard/calls — include feedback_signals in response
router.get('/calls', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    const calls = await getCallLogs(clientId, req.query);

    // Surface FAQ gap signal: calls with no booking outcome
    const unbookedCount = calls.data.filter((c) => c.outcome === 'no_booking').length;
    const feedbackSignal = unbookedCount > 3
      ? { type: 'faq_gap', message: `${unbookedCount} recent calls ended without a booking. Consider adding FAQs for common questions.` }
      : null;

    res.json({ ...calls, feedback_signal: feedbackSignal });
  } catch (err) {
    next(err);
  }
});
```

## Wallet Churn Signal

Detect clients at risk of churn: wallet empty + no top-up in 7 days.

```sql
-- Identify at-risk clients for n8n outreach
SELECT c.client_id, c.company_name, cw.balance_cents,
       MAX(wt.created_at) AS last_top_up
FROM clients c
JOIN client_wallets cw ON cw.client_id = c.client_id
LEFT JOIN wallet_transactions wt ON wt.client_id = c.client_id AND wt.type = 'credit'
WHERE c.is_active = true
  AND cw.balance_cents = 0
GROUP BY c.client_id, c.company_name, cw.balance_cents
HAVING MAX(wt.created_at) < NOW() - INTERVAL '7 days'
    OR MAX(wt.created_at) IS NULL;
```

Fire this via n8n on a scheduled webhook and route to CRM/email.

## Dashboard Config Change as Intent Signal

When a client changes scheduling config, they are actively engaged — this is a moment to surface advanced features.

```javascript
// src/routes/dashboard.js
router.put('/scheduling', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    await updateSchedulingConfig(clientId, req.body);
    await invalidateGuidanceCache(clientId);

    // Log intent signal for n8n downstream
    logger.info('client_config_updated', {
      client_id: clientId,
      section: 'scheduling',
      intent_signal: 'high_engagement',
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

## n8n Post-Call Feedback Webhook

Fire after POST /api/v1/call/complete to trigger async feedback collection or CRM logging.

```javascript
// src/routes/call.js — inside call complete handler, fire-and-forget
function firePostCallFeedbackAsync(clientId, callLog) {
  const axios = require('axios');
  axios.post(`${process.env.N8N_WEBHOOK_BASE_URL}/post-call-feedback`, {
    client_id: clientId,
    call_id: callLog.id,
    outcome: callLog.outcome,
    duration_seconds: callLog.duration_seconds,
    caller_phone: callLog.caller_phone,
  }).catch((err) => {
    logger.warn('Post-call feedback webhook failed', { call_id: callLog.id, error: err.message });
  });
}
```

## DO / DON'T

**DO** derive feedback signals from existing data (call outcomes, wallet balance, config changes).
**DON'T** build a separate feedback submission form until you've exhausted implicit signals.

**DO** fire feedback webhooks fire-and-forget, never in the critical request path.
**DON'T** await n8n in POST /api/v1/call/complete — that endpoint is called during a live call.

**DO** surface feedback signals only when actionable (e.g., 3+ unbooked calls).
**DON'T** show a "FAQ gap" warning after a single unbooked call — noise erodes trust.

## WARNING: Storing raw transcripts in application memory

```javascript
// BAD — accumulating transcripts in a module-level variable
const transcriptBuffer = []; // grows unboundedly, lost on restart
transcriptBuffer.push(callTranscript);
```

Transcripts belong in `call_logs` in PostgreSQL. The stateless Express architecture means no in-memory state survives a Railway restart. See the **postgresql** skill for call_logs schema patterns.

## Feedback Collection Checklist

- [ ] Identify implicit signals: call outcome, wallet depletion, config frequency
- [ ] Add `feedback_signal` field to relevant dashboard responses
- [ ] Log intent signals (config changes, feature usage) as structured log events
- [ ] Wire n8n webhook for post-call async processing
- [ ] Define churn signal SQL query for scheduled n8n trigger
- [ ] Set thresholds (e.g., 3+ unbooked calls) before surfacing nudges

See the **orchestrating-feature-adoption** skill for turning insights into adoption nudges. See the **instrumenting-product-metrics** skill for event-level analytics.
