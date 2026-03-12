---
name: framing-release-stories
description: |
  Builds launch narratives, assets, and rollout checklists for the AI Ops multi-tenant voice agent platform.
  Use when: announcing new FSM integrations, shipping billing tier changes, launching dashboard features,
  rolling out new vertical support (e.g., restaurant, cleaning), or communicating booking/payment
  improvements to existing blue-collar service business clients.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Framing-release-stories Skill

Translates AI Ops platform changes into client-facing narratives grounded in the value delivered to
HVAC, plumbing, electrical, spa, and restaurant operators. Every release story must connect the
technical change (new FSM adapter, wallet top-up flow, soft-lock booking fix) to a concrete outcome
for the business owner — fewer missed calls, faster bookings, lower per-minute cost.

## Quick Start

### New Feature Launch Narrative

```markdown
## [Feature Name] — Now Live

**What changed:** [One sentence: the technical capability added]
**Why it matters:** [One sentence: the business outcome for operators]
**Who benefits:** [Vertical(s) affected — HVAC / Spa / Electrical / Plumbing / All]

### What you can do now
- [Action verb] + [specific capability] → [outcome]

### How to enable
[Step or dashboard path — e.g., Dashboard → Agent → Enable X]
```

### Integration Launch (New FSM)

```markdown
## [FSM Name] Integration — Live

Your AI agent now books directly into [FSM]. Confirmed appointments land in your
[FSM] job board automatically — no manual entry.

**Setup:** Dashboard → Integrations → [FSM Name] → Connect
**Requires:** [FSM] API key (Settings → Developers in your [FSM] account)

What the agent handles automatically:
- Slot availability check against your live [FSM] calendar
- Job creation on booking confirmation
- Customer record lookup for returning callers
```

### Billing / Wallet Change

```markdown
## [Tier Name] Pricing Update

Your current plan: [Tier] at $[rate]/min
[What changed and why — cost reduction, new features at tier, etc.]

Current wallet balance: $[balance] — [no action needed / top up recommended]
```

## Key Concepts

| Concept | Usage | Example |
|---------|-------|---------|
| Vertical framing | Always name the trade (HVAC, spa) not just "business" | "For HVAC operators…" |
| Outcome-first | Lead with what the operator gains, not what you built | "Fewer missed bookings" not "We added Redis SETNX" |
| Wallet-aware | Every billing change must state current balance impact | "Your wallet is unaffected" |
| FSM-specific | Name the FSM (HouseCall Pro, Jobber, ServiceTitan) | Never say "your system" |
| Rollout phase | State who gets it first: all clients vs. specific verticals | "Rolling out to HVAC clients first" |

## Common Patterns

### Phased Rollout Checklist

Copy this checklist and track progress:
- [ ] Step 1: Draft narrative using feature context from `src/routes/` or `src/services/`
- [ ] Step 2: Confirm impacted verticals (check `seeds/demo_clients.sql` for reference clients)
- [ ] Step 3: Write outcome statement — what can the operator do NOW that they couldn't before?
- [ ] Step 4: Write setup instructions tied to `/api/v1/dashboard/*` endpoints
- [ ] Step 5: Add rollback note if feature can be toggled
- [ ] Step 6: Identify wallet/billing impact (none / rate change / new deduction event)
- [ ] Step 7: Draft SMS or email version (160 chars max for SMS via Twilio)
- [ ] Step 8: Post to changelog and update `/api/v1/onboard` welcome copy if onboarding is affected

### FSM Integration Launch

**When:** Adding a new FSM adapter in `src/integrations/`

```markdown
## [FSM] Integration — Now Available

Your AI agent connects directly to [FSM], booking confirmed appointments
without manual dispatch.

Setup (5 minutes):
1. Dashboard → Integrations → [FSM]
2. Paste your [FSM] API key
3. Agent starts verifying slots against your live calendar immediately

What the agent now handles:
- Live slot check before offering times to callers
- Auto-creates job on booking confirmation
- Recognizes returning customers by phone number
```

### Wallet / Billing Tier Change

**When:** Modifying `src/services/walletService.js` pricing tiers

```javascript
// Reference: wallet tier rates (cents per minute × 100)
const TIER_RATES = {
  standard:   40,  // $0.40/min
  growth:     32,  // $0.32/min
  scale:      27,  // $0.27/min
  enterprise: 23,  // $0.23/min
};
```

```markdown
## Growth Plan: Rate Reduced to $0.30/min

Effective [date], Growth plan clients pay $0.30/min (down from $0.32/min).

Your wallet balance carries over — no action needed. The new rate applies
to all calls completed after [date].

At 200 calls/month × 4 min avg: saves ~$16/month automatically.
```

## See Also

- [conversion-optimization](references/conversion-optimization.md)
- [content-copy](references/content-copy.md)
- [distribution](references/distribution.md)
- [measurement-testing](references/measurement-testing.md)
- [growth-engineering](references/growth-engineering.md)
- [strategy-monetization](references/strategy-monetization.md)

## Related Skills

- See the **writing-release-notes** skill for changelog formatting and versioning
- See the **crafting-page-messaging** skill for updating onboarding and dashboard copy
- See the **triaging-user-feedback** skill for classifying post-launch client signals
- See the **structuring-offer-ladders** skill for framing tier upgrade moments
- See the **mapping-conversion-events** skill for instrumenting launch funnel tracking
- See the **tuning-landing-journeys** skill for updating public-facing landing pages
- See the **twilio** skill for SMS distribution of release announcements
- See the **vapi** skill for changes affecting the AI agent's call behavior
