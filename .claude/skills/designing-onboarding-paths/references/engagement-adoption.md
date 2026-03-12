# Engagement & Adoption Reference

## Contents
- Adoption signals in this codebase
- Feature adoption nudges via dashboard API
- Low-wallet alert pattern
- FSM adoption nudge
- Anti-patterns

---

## Adoption Signals

Adoption in this platform is measured by three behaviors:

| Signal | Data Source | Query |
|--------|-------------|-------|
| Agent handled calls | `call_logs` | `COUNT(*) WHERE client_id = $1` |
| Booking made by agent | `bookings` | `COUNT(*) WHERE client_id = $1` |
| Payment collected | `payment_intents` | `COUNT(*) WHERE client_id = $1 AND status = 'completed'` |

Surface these as a `usage_summary` block in `GET /api/v1/dashboard/config`:

```javascript
// src/routes/dashboard.js
const [calls, bookings, payments] = await Promise.all([
  pool.query('SELECT COUNT(*) FROM call_logs WHERE client_id = $1', [clientId]),
  pool.query('SELECT COUNT(*) FROM bookings WHERE client_id = $1', [clientId]),
  pool.query("SELECT COUNT(*) FROM payment_intents WHERE client_id = $1 AND status = 'completed'", [clientId]),
]);

res.json({
  config: client,
  usage_summary: {
    calls_handled: parseInt(calls.rows[0].count, 10),
    bookings_created: parseInt(bookings.rows[0].count, 10),
    payments_collected: parseInt(payments.rows[0].count, 10),
  },
});
```

---

## Low-Wallet Adoption Nudge

When wallet balance drops below a threshold, the dashboard config response should include a nudge. This prevents silent soft-lock into message-only mode.

```javascript
// src/routes/dashboard.js
const LOW_BALANCE_THRESHOLD_CENTS = 1000; // $10.00

const { rows: [wallet] } = await pool.query(
  'SELECT balance_cents FROM wallets WHERE client_id = $1',
  [clientId]
);

const nudges = [];
if (wallet.balance_cents < LOW_BALANCE_THRESHOLD_CENTS) {
  nudges.push({
    type: 'low_wallet',
    severity: wallet.balance_cents === 0 ? 'blocking' : 'warning',
    message: wallet.balance_cents === 0
      ? 'Your agent is in message-only mode. Fund your wallet to re-enable bookings.'
      : `Wallet balance is low ($${(wallet.balance_cents / 100).toFixed(2)}). Top up to avoid interruptions.`,
    cta: { label: 'Add funds', action: 'open_wallet_topup' },
  });
}

res.json({ config: client, nudges });
```

---

## FSM Adoption Nudge

Clients without a connected FSM miss automated booking confirmation. Surface this after the first call is handled:

```javascript
// src/routes/dashboard.js
const { rows: [integration] } = await pool.query(
  "SELECT integration_id FROM client_integrations WHERE client_id = $1 AND integration_type = 'fsm' LIMIT 1",
  [clientId]
);

const callCount = parseInt(calls.rows[0].count, 10);

if (!integration && callCount > 0) {
  nudges.push({
    type: 'no_fsm',
    severity: 'info',
    message: 'Connect your scheduling software to enable automatic booking creation.',
    cta: { label: 'Connect FSM', action: 'open_fsm_setup' },
  });
}
```

---

## FAQ Adoption Nudge (pgvector)

Clients with zero FAQs get no semantic search injection. After 5 calls, nudge them to add FAQs:

```javascript
// src/routes/dashboard.js
const { rows: [faqCount] } = await pool.query(
  'SELECT COUNT(*) FROM client_faqs WHERE client_id = $1',
  [clientId]
);

if (parseInt(faqCount.count, 10) === 0 && callCount >= 5) {
  nudges.push({
    type: 'no_faqs',
    severity: 'info',
    message: 'Add FAQs so your agent can answer common questions from callers.',
    cta: { label: 'Add FAQs', action: 'open_faq_editor' },
  });
}
```

See the **pgvector** skill for the FAQ embedding and search implementation.

---

### WARNING: Firing Nudges on Every Call (Performance Anti-Pattern)

**The Problem:**

```javascript
// BAD — runs 4 extra queries on every /api/v1/context/inject call
const nudges = await buildNudges(clientId); // inside the hot LLM path
```

**Why This Breaks:**
1. `context/inject` is a live-call hot path — latency target is <200ms total
2. Nudge queries hit PostgreSQL via PgBouncer, adding ~150ms each
3. Nudges are irrelevant to the AI agent — they're for the dashboard owner

**The Fix:**

```javascript
// GOOD — only compute nudges on dashboard config fetch, never on Vapi endpoints
// src/routes/dashboard.js — GET /api/v1/dashboard/config ONLY
const nudges = await buildNudges(clientId);
```

Nudges belong exclusively in `src/routes/dashboard.js`, never in `src/routes/vapi.js`.

---

### WARNING: Hardcoding Threshold Values

**The Problem:**

```javascript
// BAD — threshold scattered across files, impossible to tune per tier
if (wallet.balance_cents < 1000) { ... }
```

**The Fix:**

```javascript
// GOOD — named constant, single location
const LOW_BALANCE_THRESHOLD_CENTS = 1000;
```

If thresholds need to vary by tier, store them in a `billing_tiers` table, not in code.
