# Engagement & Adoption Reference

## Contents
- What "Engagement" Means Here
- Returning Caller Recognition
- Wallet Balance as Engagement Signal
- Anti-Patterns
- Deferred Feature Boundaries

---

## What "Engagement" Means Here

This is a voice AI backend — "engagement" is measured in call volume, booking conversion rate,
and wallet top-up frequency, not UI clicks. The surfaces that drive adoption are:
- **Live call quality** — returning caller recognition, FAQ injection, correct slot availability
- **Dashboard** — config completeness, call log review, wallet monitoring

## Returning Caller Recognition

The primary engagement hook is `src/services/callerMemory.js`. It looks up call history by
phone number and injects context into the prompt so the agent greets returning callers by name
and references past bookings.

```javascript
// src/services/callerMemory.js — v1 slice
async function getCallerContext(clientId, callerPhone) {
  const result = await pool.query(
    `SELECT caller_name, last_service, last_booking_date
     FROM call_logs
     WHERE client_id = $1 AND caller_phone = $2
     ORDER BY created_at DESC LIMIT 1`,
    [clientId, callerPhone]
  );
  return result.rows[0] || null;
}
```

```javascript
// src/services/promptBuilder.js — inject caller context into pre-compiled prompt
function appendCallerContext(systemPrompt, callerData) {
  if (!callerData) return systemPrompt;
  return `${systemPrompt}\n\nCALLER HISTORY:\nName: ${callerData.caller_name}\nLast service: ${callerData.last_service}`;
}
```

## Wallet Balance as Engagement Signal

Low wallet balance is the primary churn signal. When balance approaches zero, the agent
switches to message-only mode — a hard degradation clients notice immediately.

```javascript
// src/services/walletService.js — guard before every call
async function checkAndDeduct(clientId, durationSeconds) {
  const { balance_cents } = await getBalance(clientId);
  if (balance_cents <= 0) {
    return { allowed: false, reason: 'wallet_empty' };
  }
  // Deduct on call completion, not at start
  return { allowed: true };
}
```

Scope wallet top-up notifications as a high-priority engagement feature:
- **v1**: Return `wallet_empty` flag in `/api/v1/call/complete` response for n8n to act on
- **v2**: n8n webhook sends low-balance SMS to client phone via Twilio when balance < threshold
- **v3**: Dashboard shows balance alert, stripe payment link for instant top-up

## Anti-Patterns

### WARNING: Engagement Logic in Route Handlers

**The Problem:**
```javascript
// BAD — inline caller history lookup in route handler
router.post('/api/v1/context/inject', async (req, res, next) => {
  const logs = await pool.query('SELECT * FROM call_logs WHERE ...'); // inline
  const prompt = systemPrompt + formatHistory(logs.rows);
  // ...
});
```

**Why This Breaks:**
1. Route handler becomes untestable monolith
2. Any change to caller memory format requires editing auth-sensitive route file
3. Can't swap data source (e.g., move to separate analytics DB) without touching routes

**The Fix:**
```javascript
// GOOD — service handles all caller context assembly
const callerContext = await callerMemory.getCallerContext(clientId, callerPhone);
const finalPrompt = promptBuilder.appendCallerContext(client.system_prompt, callerContext);
```

## Deferred Feature Boundaries

Use this table when deciding what's v1 vs later for engagement features:

| Feature | v1 | v2 | v3 |
|---------|----|----|-----|
| Returning caller name | Return history from call_logs | Caller preference profile | Cross-client caller ID |
| FAQ injection | pgvector similarity search | Admin FAQ editor in dashboard | Auto-FAQ from call transcripts |
| Low balance alert | Flag in call/complete response | n8n SMS notification | Dashboard alert + top-up link |
| Call transcripts | Store raw in call_logs | Display in dashboard | Sentiment analysis |

See the **vapi** skill for call lifecycle scoping. See the **redis** skill for config cache patterns
that affect how quickly engagement config changes take effect.
