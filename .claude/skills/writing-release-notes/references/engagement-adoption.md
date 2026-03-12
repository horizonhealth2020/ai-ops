# Engagement & Adoption Reference

## Contents
- What "Engagement" Means in AI Ops
- Feature Adoption Signals
- Release Notes That Drive Adoption
- DO / DON'T Patterns
- Tier-Specific Feature Rollout Notes

---

## What "Engagement" Means in AI Ops

AI Ops has no in-app feed or notification center. Engagement happens through:
1. **The agent improving on live calls** — callers are the end users
2. **Dashboard config changes** — clients tune agent behavior
3. **Wallet spend** — active clients show recurring wallet top-ups

When writing a note about a feature intended to drive engagement, tie it to one of these surfaces.

---

## Feature Adoption Signals

Adoption for AI Ops features maps to observable actions in the database:

```javascript
// High-adoption signals to reference in notes:
// 1. FAQ entries added (pgvector index grows)
// 2. Business hours configured (not default)
// 3. Booking flow used (bookings table has rows)
// 4. Caller memory hit (call_logs has repeat callers)
// 5. Payment intent created (payment_transactions has rows)
```

When a feature has low adoption, the release note should explain what the client needs to
DO to enable it — not just that it exists.

---

## Release Notes That Drive Adoption

### Pattern: Action-Oriented Feature Note

```markdown
## FAQ Search Now Active by Default

Your agent now answers common questions about your business automatically.

**To get the most out of this:**
1. Dashboard → Knowledge Base → Add FAQ entries
2. Add 5-10 common questions (pricing, service area, booking process)
3. The agent retrieves the most relevant answer using semantic search

Clients with 10+ FAQ entries see 23% fewer "I'll transfer you" responses.
```

### Pattern: Tier Upgrade Hook

When a feature is tier-restricted, the release note should make the upgrade path clear:

```markdown
## Returning Caller Greeting (Growth Tier and Above)

The agent now greets repeat callers by name and references their last appointment.

Available on: Growth, Scale, Enterprise tiers.

**To enable:** Dashboard → Settings → Caller Memory → Enable

Standard tier clients hear the standard greeting. Upgrade at Dashboard → Billing → Change Plan.
```

### Pattern: Dashboard Config Required

```markdown
## After-Hours Voicemail Routing

When a call arrives outside your configured business hours, the agent now offers to
take a message instead of ending the call abruptly.

**Requires configuration:**
- Dashboard → Hours → Set your business hours
- Dashboard → Agent → Set voicemail message text

Clients without hours configured: this feature is inactive. All calls are treated as in-hours.
```

---

## DO / DON'T Patterns

**DO** — Tell clients what they need to do to benefit:
```markdown
// GOOD — actionable
To use this feature, add at least one service area to Dashboard → Scheduling → Service Zones.
```

**DON'T** — Write passive notes that assume clients will explore:
```markdown
// BAD — no call to action
Service zone support has been added to the scheduling system.
```

**DO** — Quantify the impact when data is available:
```markdown
// GOOD — gives the client a reason to act
Clients using caller memory report 18% higher booking conversion on repeat calls.
```

**DON'T** — Invent metrics without data backing:
```markdown
// BAD — fabricated claim
This feature will dramatically improve your booking rate.
```

**DO** — Link dashboard path for config-required features:
```markdown
Dashboard → Knowledge Base → Add FAQ
```

**DON'T** — Leave discovery to chance:
```markdown
// BAD — client has no idea where to find it
You can configure this in the dashboard settings.
```

---

## Tier-Specific Feature Rollout Notes

AI Ops has four billing tiers: standard, growth, scale, enterprise. Notes for tier-restricted
features must state which tiers get access.

```markdown
## Concurrent Call Handling (Scale + Enterprise)

Scale and Enterprise clients can now handle up to 3 simultaneous inbound calls. Previously,
concurrent calls received a busy signal.

| Tier | Concurrent Calls |
|------|-----------------|
| Standard | 1 |
| Growth | 1 |
| Scale | 3 |
| Enterprise | Unlimited |

No configuration required. Takes effect on next inbound call.
```

---

## Adoption Release Note Checklist

Copy this checklist when shipping a feature note aimed at driving usage:

- [ ] State what the client needs to do to activate the feature
- [ ] Include the Dashboard path if UI configuration is required
- [ ] Specify which tiers have access
- [ ] Include a concrete benefit statement (what improves for callers or the client)
- [ ] Flag if the feature requires data to work (FAQ entries, business hours, etc.)
- [ ] Avoid passive voice — use imperative ("Add FAQ entries", not "FAQ entries can be added")

See the **orchestrating-feature-adoption** skill for adoption tracking patterns.
See the **instrumenting-product-metrics** skill for measuring adoption post-release.
