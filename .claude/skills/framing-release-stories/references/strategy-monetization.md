# Strategy & Monetization Reference

## Contents
- Wallet Tier Upgrade Moments
- Payment Processor Releases (Stripe vs. Square)
- Pricing Change Communication Rules
- New Tier Announcement Framework
- WARNING: Announcing Price Increases Without Value Context

---

## Wallet Tier Upgrade Moments

The four billing tiers create natural upgrade moments. Every release that adds features
to higher tiers is an upgrade opportunity. Frame tier announcements around the moment
when a client's usage justifies the next tier.

```javascript
// src/services/walletService.js — tier rate reference (cents per minute)
const TIER_RATES = {
  standard:   40,  // $0.40/min — entry tier
  growth:     32,  // $0.32/min — 20% savings
  scale:      27,  // $0.27/min — 32.5% savings
  enterprise: 23,  // $0.23/min — 42.5% savings
};
```

**Tier upgrade story template:**
```markdown
## Your Usage Qualifies for [Growth / Scale / Enterprise]

Based on your last 30 days:
- [X] minutes of call time
- At Standard: $[current_cost]
- At [Next Tier]: $[projected_cost] — saves $[delta]/month

Upgrade once. Savings apply to every call from that point forward.

Dashboard → Wallet → Change Plan
```

**When to trigger upgrade messaging:**
- Standard client averaging >100 min/month → suggest Growth (break-even at 80 min)
- Growth client averaging >200 min/month → suggest Scale
- Scale client averaging >500 min/month → suggest Enterprise or custom contract

---

## Payment Processor Releases (Stripe vs. Square)

Both Stripe and Square are integrated. Release stories for payment changes must state
which processor is affected and whether the other is unchanged.

```javascript
// src/integrations/stripe.js — Stripe payment intent creation
async function createStripeIntent(clientId, amountCents, description) {
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,      // ALWAYS in cents (integers)
    currency: 'usd',
    metadata: { client_id: clientId, description },
  });
  return intent;
}
```

```javascript
// src/integrations/square.js — Square payment intent creation
async function createSquareIntent(clientId, amountCents, description) {
  const response = await squareClient.paymentsApi.createPayment({
    sourceId: 'EXTERNAL',
    amountMoney: { amount: BigInt(amountCents), currency: 'USD' },
    idempotencyKey: uuid(),
  });
  return response.result.payment;
}
```

**Payment processor release copy rules:**
- ALWAYS name which processor: "Stripe payment links" not "payment links"
- ALWAYS state if both are updated or only one
- For SMS payment links: name the flow end-to-end (agent → SMS → client pays → confirmation)

**Square launch story example:**
```markdown
## Square Payments Now Live

If your business uses Square, your agent can now send Square checkout links
via SMS during a call.

Caller agrees to a deposit → agent sends link → customer pays on their phone.
Payment confirmed automatically — no manual follow-up.

Enable in Dashboard → Integrations → Square. Paste your Square access token to activate.
```

---

## Pricing Change Communication Rules

NEVER announce a price increase without these elements. Each is required:

1. **Advance notice** — minimum 14 days before effective date
2. **Current vs. new rate** — show both numbers explicitly
3. **Why** — one sentence on cost drivers (infrastructure, new features, support)
4. **Grandfathering** — state if existing clients get a grace period
5. **Action path** — if they want to lock current rate, what do they do?

```markdown
// REQUIRED format for any price increase announcement:

## Pricing Update — Effective [Date]

Current [Tier] rate: $[current]/min
New [Tier] rate: $[new]/min, effective [Date]

Why: [One honest sentence — e.g., "Twilio SMS costs have increased 15%"]

**Your balance is unaffected.** Existing balance carries over at the new rate after [Date].

To lock current pricing through [Grace Period End]:
Dashboard → Wallet → Lock Rate (available until [Date])
```

---

## New Tier Announcement Framework

When adding a new tier or restructuring the tier ladder, use this sequence:

```markdown
## Introducing [Tier Name] — $[rate]/min

Built for [operator profile — e.g., "multi-truck HVAC shops handling 300+ calls/month"].

What's included:
- $[rate]/min (vs $[comparison_rate]/min at [comparison_tier])
- [Feature exclusive to this tier]
- [Feature exclusive to this tier]

At [X] calls × [Y] min avg, [Tier Name] pays for itself in the first month.

Who qualifies: Any active client. Switch instantly at Dashboard → Wallet → Change Plan.
```

**Tier launch checklist:**
- [ ] Step 1: Add new tier to `TIER_RATES` in `walletService.js`
- [ ] Step 2: Write migration if `clients.tier` enum needs updating
- [ ] Step 3: Draft announcement copy using template above
- [ ] Step 4: Identify upgrade-eligible clients (query `call_logs` for high-usage standard/growth clients)
- [ ] Step 5: Send personalized SMS to upgrade-eligible clients with their estimated savings
- [ ] Step 6: Update `/api/v1/dashboard/wallet` response to reflect new tier options

See the **structuring-offer-ladders** skill for tier ladder design and upgrade logic patterns.

---

## WARNING: Announcing Price Increases Without Value Context

**The Problem:**

```markdown
// BAD — bare price change with no value context
Effective April 1, Standard plan pricing increases from $0.40/min to $0.45/min.
```

**Why This Breaks:**
1. No context = no reason to stay — churn risk is highest at price increase announcements
2. HVAC and plumbing operators are price-sensitive small business owners; they will shop
   alternatives if you don't justify the increase
3. Missing the "what do I get now that I didn't before" framing wastes the announcement

**The Fix:**

```markdown
// GOOD — price increase with value anchoring
Standard plan: $0.45/min starting [Date] (from $0.40/min).

What's new since you joined:
- Caller memory: agent now greets repeat customers by name
- Dual payment processing: Stripe and Square both supported
- Returning caller history: last 5 visits summarized on each call

The agent handling your calls today is significantly more capable than
when you signed up. This reflects that.

Questions? Reply to this message.
```

**When You Might Be Tempted:**
Quick announcements feel efficient but strip the context that retains customers. Always
invest 3-4 sentences in value justification for any rate increase, no matter how small.
