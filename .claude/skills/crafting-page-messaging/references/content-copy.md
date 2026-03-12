# Content Copy Reference

## Contents
- Voice copy rules
- Vertical-specific tone
- Dashboard operator copy
- FAQ / pgvector content
- Anti-patterns

---

## Voice Copy Rules

Agent scripts are read aloud by Vapi's TTS. Write for the ear, not the eye.

| Rule | Reason |
|------|--------|
| Max 30 words per sentence | TTS pauses feel unnatural in long sentences |
| No special characters (`/`, `*`, `#`) | TTS reads them literally |
| Spell out numbers under 10 | "two" sounds better than "2" |
| Use contractions | "I'll" not "I will" — sounds robotic otherwise |
| No abbreviations | "HVAC" → "heating and cooling", "ETA" → "arrival time" |

```javascript
// GOOD — conversational, short, no symbols
const script = "I can get someone out to you Thursday morning between eight and ten. Does that work?";

// BAD — reads like a form
const badScript = "Appointment slot: 2024-04-18 08:00-10:00. Confirm Y/N?";
```

---

## Vertical-Specific Tone

The `clients.vertical` field in PostgreSQL drives tone. Compile this into the system prompt
in `src/services/promptCompiler.js`.

```javascript
const VERTICAL_TONE = {
  hvac:       "urgent, efficient — customers are hot or cold right now",
  plumbing:   "calm but fast — water damage is time-sensitive",
  electrical: "safety-first, reassuring — callers may be scared",
  spa:        "warm, unhurried — this is a luxury purchase",
  restaurant: "friendly, quick — reservation callers want confirmation fast",
  cleaning:   "professional, detail-oriented — trust is the sale",
};

function getPersonaInstruction(vertical) {
  return `Tone: ${VERTICAL_TONE[vertical] || "professional and helpful"}.`;
}
```

NEVER apply spa tone to an HVAC emergency call. Multi-tenant means vertical-aware copy is
mandatory, not optional.

---

## Dashboard Operator Copy (src/routes/dashboard.js)

Operators are small business owners, not developers. Error messages must be plain English
with a specific next action.

```javascript
// GOOD — plain English, next step included
router.get('/wallet', async (req, res, next) => {
  try {
    const wallet = await walletService.getBalance(clientId);
    res.json({
      balance_cents: wallet.balance,
      balance_display: `$${(wallet.balance / 100).toFixed(2)}`,
      status: wallet.balance < 2000 ? 'low' : 'ok',
      cta: wallet.balance < 2000
        ? 'Add funds to keep your agent answering calls.'
        : null,
    });
  } catch (err) { next(err); }
});

// BAD — raw cents, no guidance
res.json({ balance: 1500 });
```

---

## FAQ / pgvector Content (src/services/faqSearch.js)

FAQs stored in PostgreSQL and searched via pgvector are injected verbatim into the agent
context. Copy quality here directly affects agent accuracy.

```sql
-- FAQ entries should be question-answer pairs, not paragraphs
INSERT INTO client_faqs (client_id, question, answer, embedding)
VALUES (
  $1,
  'Do you offer same-day service?',
  'Yes, we offer same-day service for most requests. Call before noon for best availability.',
  $2
);
```

```javascript
// Inject matched FAQ into context — keep it under 80 words per answer
const faqContext = matchedFaqs
  .map(faq => `Q: ${faq.question}\nA: ${faq.answer}`)
  .join('\n\n');
```

**Copy rule for FAQ answers:** Answer the question in the first sentence. Add one supporting
detail. Stop. Agent verbosity is a UX bug.

---

## Returning Caller Recognition Copy (src/services/callerMemory.js)

When a returning caller is identified, personalize the greeting — but don't be creepy.

```javascript
// GOOD — warm, not stalkerish
const returningGreeting = lastBooking
  ? `Welcome back! Last time we helped you with ${lastBooking.service_type}. ` +
    `Are you calling about something similar today?`
  : null;

// BAD — over-personal
const badGreeting = `Hello ${callerName}, I see you called on ${lastCallDate} at ${lastCallTime}.`;
```

Mention the service, not the date/time. Trade callers find date-recall unsettling.

---

## WARNING: Generic Error Copy

**The Problem:**
```javascript
// BAD — useless to operator, no action
res.status(500).json({ error: "Internal server error" });
```

**Why This Breaks:**
1. Operator sees a red error in the dashboard with no diagnosis path
2. Support tickets increase — operators can't self-serve
3. Agents downstream get no fallback script — Vapi reads the raw error

**The Fix:**
```javascript
// GOOD — specific, actionable
res.status(503).json({
  error: "FSM_UNAVAILABLE",
  message: "Your field service integration is temporarily unreachable.",
  action: "Check your HouseCall Pro API key in Settings > Integrations.",
  support_code: requestId,  // for support escalation
});
```

See the **express** skill for the global error handler pattern.
