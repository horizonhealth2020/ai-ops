# Conversion Optimization Reference

## Contents
- Onboarding Conversion Hooks
- Wallet Activation Conversion
- FSM Connection as Activation Gate
- WARNING: Feature-First Framing

---

## Onboarding Conversion Hooks

The `/api/v1/onboard` endpoint is the primary activation event. Every launch announcement
that targets new operators should include a direct path to this endpoint and confirm what
triggers it (intake form submission → client record + system prompt compiled).

```javascript
// src/routes/onboard.js — what happens on activation
// client row created, system_prompt compiled, wallet initialized at $0
// Release story must clarify: "Your agent is live after setup — no dev work needed"
router.post('/api/v1/onboard', async (req, res, next) => {
  try {
    const client = await createClient(req.body);
    await compileSystemPrompt(client.client_id);
    res.json({ client_id: client.client_id, status: 'active' });
  } catch (err) {
    next(err);
  }
});
```

**Release story pattern for onboarding improvements:**
```markdown
## Faster Setup — Agent Live in Under 5 Minutes

Previously: [what took longer]
Now: Fill out the intake form → your agent answers calls immediately.

No code. No configuration files. Your business hours, services, and
agent name are set during signup.
```

---

## Wallet Activation Conversion

Wallet balance = $0 triggers message-only mode (agent can't book or take payment).
Every release targeting wallet UX must address the zero-balance state explicitly.

```javascript
// src/services/walletService.js — zero balance gate
// This is the hard conversion wall: no balance = degraded agent
async function checkBalance(clientId) {
  const result = await pool.query(
    'SELECT balance_cents FROM wallets WHERE client_id = $1',
    [clientId]
  );
  return result.rows[0]?.balance_cents ?? 0;
}
```

**DO:** Name the zero-balance consequence in release copy.
```markdown
## Wallet Top-Up Now Available via Dashboard

Add funds directly from Dashboard → Wallet → Add Funds.
Minimum top-up: $25. Balance is consumed at your plan rate ($0.40/min standard).

If balance reaches $0, your agent continues answering but cannot book
appointments or process payments until funds are added.
```

**DON'T:** Bury the zero-balance behavior in fine print. Operators who hit $0 mid-call
will blame the agent, not the billing system. Surface it proactively.

---

## FSM Connection as Activation Gate

An agent without an FSM connection can answer calls but cannot confirm bookings against
live calendar data. FSM connection is the second activation step after wallet funding.

```javascript
// src/services/bookingService.js — FSM adapter lookup
const FSM_ADAPTERS = {
  housecall_pro: () => require('../integrations/housecallpro'),
  jobber:        () => require('../integrations/jobber'),
  servicetitan:  () => require('../integrations/servicetitan'),
};

// If no FSM configured, booking falls back to calendar hold only
// Release copy must tell operators: "Connect your FSM to enable confirmed bookings"
```

**Release story for new FSM launch:**
```markdown
## [FSM Name] Connected — Live Bookings from Every Call

Without [FSM]: agent holds a slot for 5 minutes, then releases it.
With [FSM]: agent confirms the booking in [FSM] and sends you a job alert.

Connect in 2 steps:
1. Dashboard → Integrations → [FSM Name]
2. Paste API key from [FSM] Settings → Developer Access
```

---

## WARNING: Feature-First Framing

**The Problem:**

```markdown
// BAD - leads with technical detail
We've updated our Redis SETNX hold mechanism to use a SET key namespaced
by client_id to prevent cross-tenant slot conflicts.
```

**Why This Breaks:**
1. HVAC operators do not know what Redis is — they'll stop reading
2. Feature-first copy creates zero urgency to act
3. It obscures the real value: fewer double-booked appointments

**The Fix:**

```markdown
// GOOD - leads with operator outcome
Double-bookings are now prevented automatically.

When two callers try to grab the same slot, your agent now locks the
first one instantly and offers the second caller the next available time.
No more apologetic callbacks about scheduling conflicts.
```

**When You Might Be Tempted:**
When shipping infrastructure changes (Redis upgrades, PgBouncer tuning, FSM retry logic),
it's easy to write what changed technically. Always reframe: what does the operator experience
differently on their next call?

---

## Conversion Funnel Checkpoints

Tie release copy to the three conversion events in this platform:

| Event | What to emphasize in copy | Signal of success |
|-------|--------------------------|-------------------|
| Onboard (`POST /api/v1/onboard`) | "Agent live immediately" | Client record created |
| First wallet top-up | "Enables full booking + payment" | `balance_cents > 0` |
| FSM connected | "Bookings confirmed in your job board" | `client_integrations` row created |

Every feature launch should state which of these three gates it improves or unblocks.

See the **instrumenting-product-metrics** skill for tracking these events post-launch.
See the **mapping-conversion-events** skill for wiring funnel analytics to release milestones.
