# Growth Engineering Reference

## Contents
- Growth loops in this architecture
- Returning caller recognition as retention loop
- Wallet auto-reload as retention mechanism
- FAQ search as engagement deepener
- Referral and advocacy hooks
- Anti-patterns

---

## Growth Loops in This Architecture

This platform has two latent growth loops that are partially implemented but not closed:

**Loop 1: Better data → better agent → more bookings → more data**
- Caller history via `callerMemory.js` personalizes the agent
- More bookings → more `call_logs` rows → richer history
- Currently: history is looked up but never actively surfaced to operators as a value signal

**Loop 2: Usage → wallet depletion → top-up → continued usage**
- Every call costs money (cents per minute via `walletService.js`)
- Low balance triggers message-only mode — a hard stop
- Currently: no auto-reload notification, no proactive top-up nudge before the stop

Both loops exist in code. Neither is closed with the feedback mechanisms that would make them self-reinforcing.

---

## Returning Caller Recognition as Retention Loop

`src/services/callerMemory.js` looks up caller history by phone number and injects it into the agent context. This is a genuine differentiator — the agent remembers past interactions.

```javascript
// The value: agent greets returning callers by name and references past appointments
// The gap: operators don't see this working — no metric surfaces "X returning callers this week"
```

Close the loop by adding a `returning_caller` flag to `call_logs` at call completion:

```javascript
// src/routes/call.js — at POST /api/v1/call/complete
const callerHistory = await callerMemory.lookup(callerPhone, clientId);
const isReturning = callerHistory && callerHistory.call_count > 1;

await pool.query(
  `INSERT INTO call_logs (..., is_returning_caller) VALUES (..., $N)`,
  [..., isReturning]
);
```

Then surface in `GET /api/v1/dashboard/calls`:
```javascript
// Add to call list response
returning_caller_rate: Math.round(100 * returningCount / totalCount),
```

This turns an invisible technical feature into a visible retention metric that operators care about.

---

## Wallet Auto-Reload as Retention Mechanism

The wallet auto-reload threshold is stored in the `wallets` table but never triggers anything:

```javascript
// src/services/walletService.js:95 — dead code path
if (wallet.auto_reload_enabled && balanceAfter < (wallet.auto_reload_threshold_cents || 500)) {
  logger.info('Wallet below auto-reload threshold', { ... });
  // Auto-reload would trigger Stripe charge here — deferred to payment phase
}
```

This is the correct architectural decision (Stripe charge should be async via n8n). The growth engineering work is connecting the signal to an action:

```javascript
// Complete the loop: fire n8n webhook when threshold crossed
if (wallet.auto_reload_enabled && balanceAfter < (wallet.auto_reload_threshold_cents || 500)) {
  logger.info('Wallet below auto-reload threshold', { client_id: clientId, balance: balanceAfter });
  fetch(`${process.env.N8N_WEBHOOK_BASE_URL}/wallet-auto-reload`, {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId, balance_cents: balanceAfter }),
  }).catch(() => {}); // fire-and-forget
}
```

Without this, operators who enable auto-reload discover it doesn't work only when their agent goes silent.

---

## FAQ Search as Engagement Deepener

`src/services/faqSearch.js` uses pgvector to inject semantically relevant FAQ answers into the agent context. Each FAQ injected reduces caller escalation rates. See the **pgvector** skill for implementation details.

The growth angle: operators who add FAQs see lower transfer rates and longer agent-handled calls (= more wallet usage = more engaged). Surface FAQ count and FAQ match rate in dashboard responses:

```javascript
// GET /api/v1/dashboard/config — add FAQ engagement signal
const faqCount = await pool.query(
  'SELECT COUNT(*) FROM faqs WHERE client_id = $1 AND is_active = true',
  [req.clientId]
);
res.json({
  ...config,
  faq_count: parseInt(faqCount.rows[0].count),
  // faq_match_rate requires call_logs instrumentation — future work
});
```

---

### WARNING: No Referral or Advocacy Mechanism

**The Problem:**
There is no referral code, partner attribution, or advocacy mechanism in the codebase. The `POST /api/v1/onboard` payload has no `referral_source` or `referred_by` field.

**Why This Breaks:**
Blue-collar vertical operators talk to each other. Word-of-mouth is the primary acquisition channel for this ICP. Without attribution, you cannot identify which clients are referrers or reward them.

**The Fix:** Add a `referral_source` column to `clients` and accept it at onboard:

```javascript
// Migration: ALTER TABLE clients ADD COLUMN referral_source VARCHAR(100);

// src/routes/onboard.js — accept at intake
const { ..., referral_source } = req.body;

await conn.query(
  `INSERT INTO clients (..., referral_source) VALUES (..., $N)`,
  [..., referral_source || null]
);
```

This costs one column and one parameter — no new systems needed.

---

## Related Skills

- See the **orchestrating-feature-adoption** skill for feature adoption loop patterns
- See the **strengthening-upgrade-moments** skill for wallet upgrade trigger design
- See the **stripe** skill for implementing auto-reload charge flow
- See the **pgvector** skill for FAQ search implementation
