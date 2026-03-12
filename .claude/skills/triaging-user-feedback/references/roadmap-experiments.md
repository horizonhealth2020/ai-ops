# Roadmap & Experiments Reference

## Contents
- Backlog categorization
- Quick win criteria
- Cross-tenant vs single-tenant signals
- Experiment patterns
- Triage checklist

## Backlog Categorization

Feedback in this platform falls into four backlog buckets. Assign before writing a GitHub issue.

| Bucket | Criteria | Example |
|--------|----------|---------|
| Quick win | ≤3 repro steps, no external API dependency, 1 file change | Null guard on `system_prompt` |
| Reliability bug | Reproducible error, affects bookings or payments | Redis hold not released on call complete |
| Integration gap | Requires FSM/Stripe/Square API change | New HouseCall Pro webhook field |
| Roadmap feature | New capability, requires schema migration | Voice-to-text transcript search |

## Quick Win Criteria

A feedback item is a quick win if ALL of these are true:
- Repro steps ≤ 3
- Fix is isolated to one service or route file
- No FSM API dependency
- No database migration required
- Fix does not change the Redis key schema

```javascript
// Example quick win: add null guard to promptBuilder
// src/services/promptBuilder.js
function buildPrompt(client, callerContext) {
  if (!client.system_prompt) {
    logger.warn('system_prompt missing, using fallback', { client_id: client.client_id });
    return FALLBACK_PROMPT + callerContext;  // Quick win: was throwing TypeError
  }
  return client.system_prompt + '\n\n' + callerContext;
}
```

## Cross-Tenant vs Single-Tenant Signals

NEVER escalate a single-tenant config error to the product backlog. Always verify whether an issue affects multiple clients before writing a backlog item.

```javascript
// Triage query: is this complaint cross-tenant?
const { rows } = await pool.query(
  `SELECT client_id, COUNT(*) AS failure_count
   FROM call_logs
   WHERE outcome = 'failed'
     AND error_code = $1
     AND created_at > NOW() - INTERVAL '7 days'
   GROUP BY client_id
   HAVING COUNT(*) > 2`,
  [errorCode]
);
// rows.length > 1 → cross-tenant pattern → product backlog
// rows.length === 1 → single-tenant config → support ticket
```

## Experiment Patterns

This backend has no feature flag library. Gate experiments by `client.tier` or by a `feature_flags` JSONB column added to `clients`.

```javascript
// Lightweight experiment gate using existing tier column
function isInExperiment(client, experimentName) {
  const EXPERIMENTS = {
    'extended_hold_ttl': ['growth', 'scale', 'enterprise'],
    'multi_fsm_support': ['scale', 'enterprise'],
  };
  return (EXPERIMENTS[experimentName] || []).includes(client.tier);
}

// Usage in availabilityService.js
const holdTtl = isInExperiment(client, 'extended_hold_ttl') ? 600 : 300;
await redis.set(holdKey, callId, 'EX', holdTtl, 'NX');
```

## Triage Checklist

Copy this checklist for each feedback item before writing a backlog issue:

- [ ] Step 1: Identify the client (`client_id`) and reproduce the complaint
- [ ] Step 2: Check `call_logs.outcome` and `call_logs.error_code` for the affected calls
- [ ] Step 3: Run cross-tenant query — does this affect >1 client?
- [ ] Step 4: Check if `system_prompt`, `client_integrations`, and `client_wallets` are correctly populated
- [ ] Step 5: Classify: quick win / reliability bug / integration gap / roadmap feature
- [ ] Step 6: If quick win — fix in current sprint, no issue needed
- [ ] Step 7: If backlog — write issue with: repro steps, affected `client_id`(s), classification, proposed fix

See the **scoping-feature-work** skill to slice roadmap features into shippable increments.
