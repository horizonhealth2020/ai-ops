# Activation & Onboarding Reference

## Contents
- Onboarding Flow Entry Point
- Required Activation Steps
- Wallet Funding Gate
- DO / DON'T Patterns
- Common Errors

---

## Onboarding Flow Entry Point

New clients enter via `POST /api/v1/onboard`. This is the intake form webhook — it creates the
client row, stores default config, and sets `is_active = false` until wallet is funded.

```javascript
// src/routes/onboard.js — what gets created on POST /api/v1/onboard
const clientId = uuidv4();
await pool.query(
  `INSERT INTO clients (client_id, business_name, phone_number, vertical, tier, is_active)
   VALUES ($1, $2, $3, $4, 'standard', false)`,
  [clientId, businessName, phoneNumber, vertical]
);
```

**Release note hook:** Any change to the fields accepted by `/api/v1/onboard` must document
what the intake form UI needs to send. Clients onboard via external intake — there is no
in-app signup wizard.

---

## Required Activation Steps

A client is "activated" when:
1. `POST /api/v1/onboard` succeeds — client row created
2. Clerk user created and linked to `client_id`
3. Wallet funded (balance > 0)
4. `is_active` set to `true`

```javascript
// Activation gate — checked on every inbound call in src/middleware/tenantResolver.js
if (!client.is_active) {
  return res.status(402).json({
    error: 'account_inactive',
    message: 'Wallet balance is $0. Agent is in message-only mode.'
  });
}
```

When writing a note about onboarding flow changes, state which activation step is affected.

---

## Wallet Funding Gate

The most common activation blocker. Balance lives in `client_wallets.balance_cents`.

```javascript
// src/services/walletService.js
async function checkBalance(clientId) {
  const { rows } = await pool.query(
    'SELECT balance_cents FROM client_wallets WHERE client_id = $1',
    [clientId]
  );
  return rows[0]?.balance_cents ?? 0;
}
```

**Release note template for wallet changes:**

```markdown
## Wallet Minimum Balance Enforcement

New clients must fund their wallet before the agent activates. Minimum top-up: $20.00 (2000 cents).

Dashboard: Billing → Top Up Wallet
API: `GET /api/v1/dashboard/wallet` returns `{ balance_cents, min_topup_cents }`
```

---

## DO / DON'T Patterns

**DO** — State the before/after behavior:
```markdown
Previously, clients with $0 balance received an error. Now they receive a graceful
"message-only mode" response that collects the caller's name and number for callback.
```

**DON'T** — Write vague notes without behavior delta:
```markdown
// BAD — tells the reader nothing actionable
Improved onboarding experience for new clients.
```

**DO** — Specify which vertical(s) the change applies to:
```markdown
// GOOD — scoped to the affected client segment
Applies to: hvac, plumbing, electrical. Spa and restaurant verticals unaffected.
```

**DON'T** — Skip migration steps for breaking onboarding contract changes:
```markdown
// BAD — onboard webhook callers have no idea what to update
Updated onboard endpoint to require `timezone` field.

// GOOD
BREAKING: `POST /api/v1/onboard` now requires `timezone` (IANA string, e.g. "America/New_York").
Requests missing this field return 400. Update your intake form to collect and send this value.
```

---

## Common Errors

**"Client not found for phone number"** after onboarding:
- Phone must be E.164 format: `+1XXXXXXXXXX`
- Check `clients.phone_number` — intake form may be stripping the `+`

**Wallet shows $0 after top-up:**
- `balance_cents` uses integer arithmetic — ensure payment processor sends amount in cents
- See the **stripe** skill and **square** skill for payment intent creation patterns

**`is_active` stuck as `false`:**
- Clerk webhook may not have fired — check `POST /api/v1/onboard` logs
- Manual fix: `UPDATE clients SET is_active = true WHERE client_id = $1`

---

## Onboarding Release Note Checklist

Copy this checklist when shipping an onboarding change:

- [ ] State which onboarding step changed (intake, wallet, activation)
- [ ] Document new required fields with type and example value
- [ ] Flag breaking changes with `## Breaking:` prefix
- [ ] Include migration path for existing clients
- [ ] Note which verticals / tiers are affected
- [ ] Reference the dashboard path if UI is involved

See the **designing-onboarding-paths** skill for first-run flow design patterns.
