# Engagement & Adoption Reference

## Contents
- Feature nudge patterns
- Low-balance wallet nudge
- FSM adoption nudge
- Returning caller nudge
- Nudge suppression (don't repeat)
- Anti-patterns

---

## Nudge Shape

All nudges follow a consistent shape so the dashboard frontend can render them uniformly:

```javascript
// Standard nudge object — include in any dashboard response
const nudge = {
  type: 'low_balance',           // machine-readable identifier
  severity: 'warning',           // 'info' | 'warning' | 'error'
  message: 'Add funds to keep your agent active.', // human-readable
  action: {
    label: 'Add funds',
    endpoint: '/api/v1/payment/create-intent',
  },
};
```

## Low-Balance Wallet Nudge

```javascript
// src/routes/dashboard.js
const LOW_BALANCE_THRESHOLD_CENTS = 1000; // $10.00

router.get('/wallet', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    const wallet = await walletService.getBalance(clientId);

    let nudge = null;
    if (wallet.balance_cents === 0) {
      nudge = { type: 'wallet_empty', severity: 'error',
        message: 'Your wallet is empty. Your agent is in message-only mode.' };
    } else if (wallet.balance_cents < LOW_BALANCE_THRESHOLD_CENTS) {
      nudge = { type: 'low_balance', severity: 'warning',
        message: 'Your wallet is running low. Add funds to avoid interruptions.' };
    }

    res.json({ ...wallet, nudge });
  } catch (err) {
    next(err);
  }
});
```

## FSM Adoption Nudge

Surface in GET /api/v1/dashboard/config when no FSM is connected.

```javascript
// src/services/guidanceService.js
async function getFsmNudge(clientId) {
  const result = await pool.query(
    `SELECT COUNT(*) AS cnt FROM client_integrations
     WHERE client_id = $1 AND integration_type = 'fsm'`,
    [clientId]
  );
  if (parseInt(result.rows[0].cnt, 10) > 0) return null;

  return {
    type: 'no_fsm',
    severity: 'info',
    message: 'Connect your scheduling system to enable live appointment booking.',
  };
}
```

## Suppressing Repeated Nudges

Use Redis to suppress a nudge after the user has dismissed it (requires dashboard to POST a dismiss event).

```javascript
// POST /api/v1/dashboard/nudge-dismiss
router.post('/nudge-dismiss', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    const { nudge_type } = req.body;
    // suppress for 7 days
    await redis.setex(`nudge_dismissed:${clientId}:${nudge_type}`, 86400 * 7, '1');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Check suppression before including nudge
async function isNudgeSuppressed(clientId, nudgeType) {
  const key = `nudge_dismissed:${clientId}:${nudgeType}`;
  return (await redis.exists(key)) === 1;
}
```

## DO / DON'T

**DO** return `nudge: null` when no nudge applies — never omit the field. Frontend relies on null check.
**DON'T** return multiple nudges at once (array). One nudge per response surface keeps the UI uncluttered.

**DO** use severity levels (`info`/`warning`/`error`) so the frontend styles nudges appropriately.
**DON'T** hardcode color or style in the API response — that's the frontend's job.

**DO** suppress dismissed nudges via Redis TTL.
**DON'T** store dismiss state in PostgreSQL — this is ephemeral UX state, not business data.

## WARNING: Nudge on every request without suppression

```javascript
// BAD — fires wallet nudge on every GET /wallet, no dismiss support
res.json({ ...wallet, nudge: { type: 'low_balance', message: '...' } });
```

Without suppression, a client who has seen a nudge 20 times and chosen not to act will be badgered on every page load. This erodes trust and generates support tickets. Use Redis-based dismiss TTL.

See the **orchestrating-feature-adoption** skill for nudge sequencing strategy. See the **redis** skill for TTL patterns.
