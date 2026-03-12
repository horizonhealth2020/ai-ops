# Feedback & Insights Reference

## Contents
- Feedback Sources in AI Ops
- Mapping Feedback to Release Notes
- Common Client Complaint Patterns
- DO / DON'T Patterns
- Closing the Loop in Notes

---

## Feedback Sources in AI Ops

AI Ops has no in-app feedback widget. Client feedback arrives through:

1. **Support channels** — direct complaints about call behavior or dashboard issues
2. **Call logs** — `outcome = 'transferred'` or `outcome = 'abandoned'` signals agent failure
3. **Wallet churn** — clients who stop topping up (wallet activity drops to zero)
4. **Booking failure rate** — high `status = 'failed'` rate in `bookings` table
5. **n8n post-call webhooks** — async signals after call completion

When a release note addresses client-reported feedback, state that explicitly.

---

## Mapping Feedback to Release Notes

### Pattern: Feedback-Driven Fix Note

```markdown
## Fix: Agent Incorrectly Refusing After-Hours Calls

**Reported by:** Multiple HVAC clients reporting missed bookings on weekend calls.

**Root cause:** Business hours timezone was stored in UTC but compared against local time.
Calls at 9am EST on Saturday were rejected because 9am EST = 2pm UTC, which appeared
to be "after hours" in UTC.

**Fix:** `src/utils/timeUtils.js` now converts stored hours to the client's configured
timezone before comparison. The `clients.timezone` field (IANA string) is now required
on all new accounts.

**Impact:** ~140 calls per week that were incorrectly rejected will now route correctly.
```

### Pattern: Acknowledging the Source

When feedback comes from a specific vertical or client type, name it without identifying
the specific client (maintain multi-tenant privacy):

```markdown
## Improvement: Square Payment Link SMS Delivery

Following reports from restaurant and spa clients of SMS payment links not being
delivered to mobile numbers, Twilio's message status is now logged to `call_logs.sms_status`.

Failed deliveries trigger a retry after 30s. Previously, a failed Twilio send silently dropped.
```

---

## Common Client Complaint Patterns

These are the highest-frequency pain points in this platform. Reference them when writing
notes that address known issues:

| Complaint Pattern | Root Cause Location | Note Trigger |
|-------------------|--------------------|----|
| "Agent doesn't know my hours" | `clients.business_hours` null or wrong timezone | Hours / timezone fix note |
| "Caller couldn't book, got transferred" | FSM verification timeout or `bookings.status = failed` | Booking reliability note |
| "Payment link never arrived" | Twilio delivery failure, silent error | SMS retry / logging note |
| "Same slot booked twice" | Redis hold race condition, SETNX not checked | Booking concurrency fix note |
| "Agent doesn't remember repeat callers" | `callerMemory.js` not finding match, wrong E.164 format | Caller memory fix note |
| "Dashboard shows wrong balance" | Wallet deduction using floating-point math | Cents conversion fix note |

---

## Querying for Feedback Signals

```javascript
// High transfer rate = agent failing to answer questions
const highTransferClients = await pool.query(
  `SELECT
     client_id,
     COUNT(*) FILTER (WHERE outcome = 'transferred') AS transferred,
     COUNT(*) AS total,
     ROUND(COUNT(*) FILTER (WHERE outcome = 'transferred')::numeric / COUNT(*) * 100, 1) AS transfer_pct
   FROM call_logs
   WHERE created_at >= NOW() - INTERVAL '7 days'
   GROUP BY client_id
   HAVING COUNT(*) > 10
   ORDER BY transfer_pct DESC
   LIMIT 20`,
  []
);

// Booking failure rate by FSM type
const fsmFailures = await pool.query(
  `SELECT
     ci.integration_type AS fsm,
     COUNT(*) FILTER (WHERE b.status = 'failed') AS failed,
     COUNT(*) AS total
   FROM bookings b
   JOIN client_integrations ci ON ci.client_id = b.client_id AND ci.integration_type != 'payment'
   WHERE b.created_at >= NOW() - INTERVAL '14 days'
   GROUP BY ci.integration_type`,
  []
);
```

Include the relevant query signal in the release note when a fix addresses a measurable failure rate.

---

## DO / DON'T Patterns

**DO** — Acknowledge feedback origin when it drives a release:
```markdown
// GOOD — builds trust with clients
This fix addresses a recurring issue reported by clients in the HVAC and plumbing verticals.
```

**DON'T** — Be defensive or minimize the impact:
```markdown
// BAD — dismissive
Minor edge case where some calls may have been incorrectly handled in rare scenarios.
```

**DO** — Quantify the scope of impact in the fix note:
```markdown
// GOOD
This affected approximately 8% of after-hours calls for clients with non-UTC timezones.
```

**DON'T** — Omit the scope when it's known:
```markdown
// BAD
Some calls may have been affected by this issue.
```

**DO** — State what clients need to do after a fix (often: nothing):
```markdown
// GOOD — removes anxiety
No action required. The fix applies automatically to all future calls.
```

---

## Closing the Loop in Notes

When a note addresses a known complaint, close the loop explicitly:

```markdown
## Fix: Wallet Balance Discrepancy After Call

Wallet deductions were using floating-point division to calculate per-minute cost,
causing rounding errors that compounded across multiple calls.

All monetary values now use integer cent arithmetic throughout `walletService.js`.

**Historical balances:** No retroactive correction is applied. If you believe your balance
is incorrect by more than $1.00, contact support with your client ID and we'll audit
your transaction history.
```

---

## Feedback Note Checklist

Copy this when writing a note that addresses client feedback:

- [ ] Acknowledge the feedback source (vertical, complaint pattern, or failure metric)
- [ ] State the root cause clearly (which file / function / table was wrong)
- [ ] Quantify impact scope if data is available
- [ ] Confirm whether client action is required post-fix
- [ ] Include a path to report residual issues (support contact or query to run)
- [ ] Do NOT identify specific clients by name — use vertical or tier scope only

See the **triaging-user-feedback** skill for classifying raw feedback into backlog items.
See the **instrumenting-product-metrics** skill for setting up ongoing failure rate monitoring.
