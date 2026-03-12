# In-App Guidance Reference

## Contents
- Guidance payload contract
- Context injection into dashboard responses
- Feature hint embedding
- Tooltip data in config response
- Empty state responses
- Anti-patterns

---

## Guidance Payload Contract

Every dashboard endpoint MAY include a `guidance` field. The contract is:

```javascript
// Guidance envelope — optional in any dashboard response
{
  "guidance": {
    "nudge": null | { type, severity, message, action? },
    "setup_checklist": null | { steps[], completed, total, all_complete },
    "hints": []  // array of { target: string, text: string }
  }
}
```

Return `guidance: null` when nothing to surface. Return the full envelope when any guidance is active.

## Context Injection into GET /api/v1/dashboard/config

This is the primary surface for guidance. The frontend loads config on mount — attach all setup guidance here.

```javascript
// src/routes/dashboard.js
const { getSetupChecklistCached } = require('../services/guidanceService');

router.get('/config', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    const [config, checklist, fsmNudge] = await Promise.all([
      getClientConfig(clientId),
      getSetupChecklistCached(clientId),
      getFsmNudge(clientId),
    ]);

    const guidance = (fsmNudge || !checklist.all_complete)
      ? { nudge: fsmNudge, setup_checklist: checklist, hints: [] }
      : null;

    res.json({ ...config, guidance });
  } catch (err) {
    next(err);
  }
});
```

## Feature Hint Embedding

Hints are key/value pairs: `target` is a UI element identifier the frontend uses to anchor a tooltip; `text` is the copy.

```javascript
// src/services/guidanceService.js
async function getFeatureHints(clientId) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM call_logs WHERE client_id = $1) AS call_count
     FROM clients WHERE client_id = $1`,
    [clientId]
  );

  const hints = [];
  if (parseInt(result.rows[0].call_count, 10) === 0) {
    hints.push({
      target: 'calls_tab',
      text: 'Call history appears here after your first inbound call.',
    });
    hints.push({
      target: 'wallet_balance',
      text: 'Minutes are deducted from your wallet after each call completes.',
    });
  }

  return hints;
}
```

## Empty State Responses for Dashboard Endpoints

Return structured empty states so the frontend can render contextual guidance instead of a blank screen.

```javascript
// src/routes/dashboard.js
router.get('/calls', requireClerkAuth, async (req, res, next) => {
  try {
    const { clientId } = req.tenant;
    const calls = await getCallLogs(clientId, req.query);

    if (calls.total === 0) {
      return res.json({
        calls: [],
        total: 0,
        guidance: {
          empty_state: {
            title: 'No calls yet',
            body: 'When your agent handles its first call, you\'ll see a full transcript and recording here.',
          },
        },
      });
    }

    res.json(calls);
  } catch (err) {
    next(err);
  }
});
```

## DO / DON'T

**DO** compute guidance in parallel with the main payload using `Promise.all`.
**DON'T** make guidance a sequential second query — it adds latency to every dashboard load.

**DO** return `guidance: null` explicitly when no guidance applies.
**DON'T** omit the `guidance` key — the frontend should not have to handle `undefined`.

**DO** keep hint `target` values as stable string identifiers (e.g., `'calls_tab'`, `'wallet_balance'`).
**DON'T** embed CSS selectors or DOM paths in hints — that couples the API to frontend implementation details.

## WARNING: Returning guidance for inactive clients

```javascript
// BAD — returns setup guidance even for fully onboarded clients on every request
const checklist = await getSetupChecklist(clientId); // always included
res.json({ ...config, setup_checklist: checklist });
```

Once `all_complete = true`, include `guidance: null`. Showing setup steps to a client who has been live for six months creates confusion. Gate guidance inclusion on `!checklist.all_complete`.

See the **crafting-empty-states** skill for empty state copy patterns. See the **express** skill for response shape conventions.
