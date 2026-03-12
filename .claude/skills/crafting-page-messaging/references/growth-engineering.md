# Growth Engineering Reference

## Contents
- Returning caller recognition as retention lever
- Wallet low-balance copy as churn prevention
- FAQ as self-serve knowledge growth
- Referral/word-of-mouth copy hooks
- Anti-patterns

---

## Returning Caller Recognition as Retention Lever

Returning callers who feel recognized re-book at higher rates. The `callerMemory` service
injects call history into context. Write scripts that use this data.

```javascript
// src/services/callerMemory.js — what gets injected
async function getCallerContext(clientId, callerPhone) {
  const history = await pool.query(
    `SELECT service_type, booking_date, outcome
     FROM call_logs
     WHERE client_id = $1 AND caller_phone = $2
     ORDER BY ended_at DESC LIMIT 3`,
    [clientId, callerPhone]
  );

  if (history.rows.length === 0) return null;

  const lastBooking = history.rows.find(r => r.outcome === 'booked');
  return {
    is_returning: true,
    last_service: lastBooking?.service_type,
    call_count: history.rows.length,
  };
}
```

```javascript
// src/services/promptBuilder.js — use context in script
function buildCallerGreeting(callerContext) {
  if (!callerContext?.is_returning) return null;
  if (callerContext.last_service) {
    return `Welcome back! Last time we helped with your ${callerContext.last_service}. ` +
           `What can we help you with today?`;
  }
  return `Good to hear from you again! How can we help?`;
}
```

Growth impact: returning callers convert ~30% faster when greeted by name or service.
Measure via `call_count > 1` segment in `call_logs`.

---

## Wallet Low-Balance Copy as Churn Prevention

The highest-churn moment is when an operator logs into the dashboard and sees a $0 balance.
The copy at `GET /api/v1/dashboard/wallet` must make reloading feel urgent and easy.

```javascript
// src/routes/dashboard.js
function buildWalletWarning(balanceCents, tier) {
  const ratePerMin = { standard: 40, growth: 32, scale: 27, enterprise: 23 }[tier];
  const minsRemaining = Math.floor(balanceCents / ratePerMin);

  if (balanceCents === 0) {
    return {
      level: 'critical',
      message: "Your agent has stopped answering calls. Add funds to reactivate.",
      cta: "Add funds now",
    };
  }
  if (minsRemaining < 30) {
    return {
      level: 'warning',
      message: `About ${minsRemaining} minutes of call time remaining. ` +
               `Add funds before your next busy period.`,
      cta: "Top up wallet",
    };
  }
  return null;
}
```

Tying the warning to minutes remaining (not dollar amount) is more concrete for
blue-collar operators — they think in calls, not dollars.

---

## FAQ as Self-Serve Knowledge Growth

Every FAQ entry added to `client_faqs` reduces the rate of "transferred" calls (caller
needs human). Track the transfer rate as a proxy for FAQ coverage gaps.

```sql
-- Find common transfer reasons to identify FAQ gaps
SELECT
  transfer_reason,
  COUNT(*) as frequency
FROM call_logs
WHERE client_id = $1
  AND outcome = 'transferred'
  AND ended_at > NOW() - INTERVAL '30 days'
GROUP BY transfer_reason
ORDER BY frequency DESC
LIMIT 10;
```

```javascript
// Prompt operator to fill FAQ gaps when transfer rate is high
const transferRate = transferredCalls / totalCalls;
const faqCta = transferRate > 0.15
  ? {
      message: "15% of callers are being transferred. " +
               "Adding FAQs for common questions can reduce this.",
      action: "Add FAQ answers",
      top_transfer_reasons: topReasons,
    }
  : null;
```

See the **pgvector** skill for FAQ embedding and similarity search setup.

---

## Referral / Word-of-Mouth Copy Hooks

After a successful booking, the agent can seed a referral ask. This fires in the post-booking
script compiled into the system prompt.

```javascript
// src/services/promptCompiler.js
const POST_BOOKING_REFERRAL =
  "Before I let you go — if you know anyone else who needs [service_type], " +
  "we'd love to help them too. Have a great day!";

// Only add to prompt if client has referral program enabled
if (client.referral_enabled) {
  sections.push(POST_BOOKING_REFERRAL.replace('[service_type]', client.primary_service));
}
```

Keep referral copy after the booking confirmation — never before. Asking for a referral
before confirming the appointment feels presumptuous and can undo the close.

---

## WARNING: Growth Copy That Blocks the Primary Conversion

**The Problem:**
```javascript
// BAD — referral ask interrupts the booking close
const script =
  "Before we schedule — do you have any friends who might want our service? " +
  "Now, let's get you booked for Thursday...";
```

**Why This Breaks:**
1. Interrupts the booking momentum at the most critical moment
2. Caller may say "actually let me think about it" and hang up
3. Growth copy must always come AFTER the conversion is locked

**The Fix:**
```javascript
// GOOD — referral is a post-close add-on, never a gatekeeper
const postBookingScript =
  `You're all set for Thursday at 9 AM! We'll send a reminder the day before. ` +
  `If you know anyone who needs ${client.primary_service}, feel free to pass our number along.`;
```

---

## Growth Copy Checklist

- [ ] Is returning caller recognition enabled? Check `callerMemory.js` injection
- [ ] Does the wallet warning use minutes-remaining language?
- [ ] Is the wallet CTA label action-forward ("Add funds", not "Insufficient balance")?
- [ ] Is FAQ coverage measured against transfer rate monthly?
- [ ] Is referral copy placed AFTER the booking confirmation, never before?
- [ ] Are all growth hooks behind feature flags (`client.referral_enabled`, etc.)?
