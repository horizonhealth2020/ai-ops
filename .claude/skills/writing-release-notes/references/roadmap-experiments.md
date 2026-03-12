# Roadmap & Experiments Reference

## Contents
- Experiment Patterns in AI Ops
- Feature Flag Pattern via Client Config
- Documenting Graduated Rollouts
- Breaking Changes Protocol
- Roadmap-Driven Note Structure

---

## Experiment Patterns in AI Ops

AI Ops has no A/B test framework. Experiments are implemented as:
1. **Per-client config flags** — toggle behavior per `client_id` in the `clients` table
2. **Tier-gated features** — new behavior ships to Scale/Enterprise first, then rolls down
3. **Vertical-gated features** — ship to `hvac` clients before `spa` or `restaurant`

```javascript
// src/services/promptBuilder.js — per-client feature flag pattern
async function buildPrompt(clientId, callerPhone) {
  const config = await getClientConfig(clientId);

  // Experiment: enhanced caller greeting (flagged per client)
  const useEnhancedGreeting = config.feature_flags?.enhanced_greeting ?? false;

  const greeting = useEnhancedGreeting
    ? await buildEnhancedGreeting(config, callerPhone)
    : config.system_prompt;

  return greeting;
}
```

When writing a note for a graduated rollout, state the rollout stages clearly.

---

## Feature Flag Pattern via Client Config

Store flags in a `feature_flags` JSONB column on the `clients` table:

```sql
-- Add feature_flags column (migration pattern)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';

-- Enable a flag for a specific client
UPDATE clients
SET feature_flags = feature_flags || '{"enhanced_greeting": true}'::jsonb
WHERE client_id = $1;

-- Enable for all Scale/Enterprise clients
UPDATE clients
SET feature_flags = feature_flags || '{"enhanced_greeting": true}'::jsonb
WHERE tier IN ('scale', 'enterprise');
```

**Release note for flag-gated features:**

```markdown
## Enhanced Caller Greeting (Early Access — Scale + Enterprise)

The agent now personalizes the opening greeting using caller name, last booking date,
and preferred service type.

**Status:** Enabled for Scale and Enterprise clients. Standard and Growth: shipping next quarter.

To opt out: contact support to disable `enhanced_greeting` for your account.
```

---

## Documenting Graduated Rollouts

Use a rollout table in notes for phased deployments:

```markdown
## Semantic FAQ Search — Graduated Rollout

pgvector-powered FAQ retrieval replaces keyword matching. Rolled out in phases:

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Scale + Enterprise | Complete |
| 2 | Growth | Complete |
| 3 | Standard | In progress |

**Impact:** Average FAQ retrieval relevance improved from 62% to 91% match rate
(measured via manual review of 500 sample queries across 10 clients).

No client action required. FAQ entries you've added are automatically re-indexed.
```

---

## Breaking Changes Protocol

### WARNING: Breaking API Contract Changes

Breaking changes require a **minimum 2-week notice window** in release notes before taking effect.

```markdown
## NOTICE: Breaking Change — `POST /api/v1/booking/create` (Effective [DATE])

The `slot_id` field will become required (currently optional, defaults to null).

**Current behavior:** Omitting `slot_id` creates a booking without a Redis hold, bypassing
the soft-lock. This causes double-booking when concurrent calls target the same slot.

**New behavior:** Requests without `slot_id` return `400 { "error": "slot_id_required" }`.

**Migration:**
1. Add `POST /api/v1/availability/hold` to your booking flow
2. Pass the returned `hold_id` as `slot_id` in `/api/v1/booking/create`
3. Test with the demo client credentials before your go-live date
```

### Breaking Change Checklist

Copy this checklist before publishing a breaking change note:

- [ ] `## Breaking:` or `## NOTICE: Breaking Change` prefix in heading
- [ ] State the effective date as an absolute date (not "next week")
- [ ] Describe current behavior and why it's being changed
- [ ] Describe new behavior and the exact error response
- [ ] Provide a step-by-step migration path
- [ ] Include a rollback window (how long old behavior is preserved)

---

## Roadmap-Driven Note Structure

When shipping an item from a known roadmap, tie the note to the client outcome, not the
implementation detail:

```markdown
## Jobber GraphQL Booking (Roadmap Item: Multi-FSM Support)

Jobber clients can now book appointments directly through the AI agent. The agent verifies
slot availability via Jobber's GraphQL API before confirming.

**Setup:** Dashboard → Integrations → Jobber → Connect with OAuth

This completes the multi-FSM milestone. Supported FSMs: HouseCall Pro, Jobber, ServiceTitan.
Google Calendar support is next (ETA: Q2).
```

AVOID implementation details like "we refactored the FSM adapter to use a factory pattern" —
clients care about outcomes, not architecture.

See the **scoping-feature-work** skill for breaking features into shippable increments.
See the **vapi** skill for documenting changes to the Vapi webhook contract.
