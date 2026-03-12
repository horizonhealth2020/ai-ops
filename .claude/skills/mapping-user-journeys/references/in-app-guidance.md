# In-App Guidance Reference

## Contents
- Dashboard error surface mapping
- Auth failure chains
- Soft-lock feedback to callers
- FSM rejection handling
- DO/DON'T pairs

## Dashboard Error Surface Mapping

All dashboard endpoints use Clerk JWT auth. When auth fails, the response must guide the client, not expose internals.

```javascript
// src/middleware/auth.js — Clerk JWT verification
async function requireClerkAuth(req, res, next) {
  try {
    const { userId } = await verifyClerkToken(req.headers.authorization);
    const client = await getClientByClerkId(userId);
    if (!client) {
      return res.status(403).json({ error: 'Account not found. Complete onboarding first.' });
    }
    req.auth = { clientId: client.client_id, userId };
    next();
  } catch (err) {
    // DON'T expose raw Clerk error — it leaks token structure
    return res.status(401).json({ error: 'Authentication required. Please log in again.' });
  }
}
```

**FRICTION:** A raw `err.message` from Clerk JWT verification often includes internal token metadata. Always map to a user-friendly message.

## Auth Failure Chain

```
Client hits dashboard endpoint
  → Clerk token present? No → 401 "Authentication required"
  → Token valid?         No → 401 "Authentication required"
  → client_id found?     No → 403 "Account not found. Complete onboarding first."
  → is_active?           No → 403 "Account suspended. Contact support."
  → proceed to handler
```

Implement this chain explicitly — don't rely on middleware order to communicate meaning.

## Soft-Lock Feedback to Callers

When a slot hold fails (another call grabbed it), the agent must immediately offer alternatives — not dead air.

```javascript
// src/routes/availability.js — POST /api/v1/availability/hold
router.post('/hold', requireVapiAuth, async (req, res, next) => {
  try {
    const { clientId, date, time } = req.body;
    const held = await availabilityService.holdSlot(clientId, date, time);

    if (!held.success) {
      // Return alternatives immediately — never return an empty failure
      const alternatives = await availabilityService.getNextAvailable(clientId, date);
      return res.json({
        held: false,
        message: `That slot was just taken. Available times: ${alternatives.join(', ')}`,
        alternatives,
      });
    }

    res.json({ held: true, hold_id: held.holdId, expires_in: 300 });
  } catch (err) {
    next(err);
  }
});
```

## FSM Rejection Handling

FSM APIs (HouseCall Pro, Jobber, ServiceTitan) can reject a booking even after a Redis hold succeeds. The caller needs a graceful fallback.

```javascript
// src/services/bookingService.js — FSM verify + create
async function confirmBooking(clientId, holdId, bookingData) {
  const adapter = FSM_ADAPTERS[clientFsmType]();
  const credentials = await getDecryptedCredentials(clientId);

  const isAvailable = await adapter.verifySlotAvailability(
    credentials, clientId, bookingData.date, bookingData.time
  );

  if (!isAvailable) {
    // Release the Redis hold — don't leave it dangling
    await releaseHold(clientId, holdId);
    const alternatives = await getAlternativeSlots(clientId, bookingData.date);
    return {
      confirmed: false,
      message: 'That time is no longer available in our system.',
      alternatives,
    };
  }

  const jobId = await adapter.createJob(credentials, clientId, bookingData);
  await pool.query('INSERT INTO bookings (...) VALUES (...)', [...]);
  await releaseHold(clientId, holdId);

  return { confirmed: true, job_id: jobId };
}
```

## DO / DON'T

```javascript
// DO — release hold on FSM rejection
await releaseHold(clientId, holdId);
return { confirmed: false, alternatives };

// DON'T — leave hold dangling on failure
// The slot stays locked for 300s, blocking other callers from booking it
throw new Error('FSM rejected booking');
```

```javascript
// DO — map all auth errors to user-friendly messages
return res.status(401).json({ error: 'Authentication required. Please log in again.' });

// DON'T — leak internal error details
return res.status(401).json({ error: err.message });
// Exposes: "JsonWebTokenError: invalid signature" — useless and potentially harmful
```

## WARNING: Missing Fallback on External API Timeout

**The Problem:**
```javascript
// BAD — no timeout on FSM call
const jobId = await adapter.createJob(credentials, clientId, bookingData);
```

**Why This Breaks:**
1. HouseCall Pro / Jobber can timeout under load
2. Caller is left in silence — Vapi may cut the call
3. Redis hold stays active, slot appears booked but isn't

**The Fix:**
```javascript
// GOOD — wrap FSM calls with a timeout
const jobId = await Promise.race([
  adapter.createJob(credentials, clientId, bookingData),
  new Promise((_, reject) => setTimeout(() => reject(new Error('FSM timeout')), 8000)),
]);
```

## Related Skills

- See the **vapi** skill for SSE streaming and tool call response formats
- See the **redis** skill for hold cleanup patterns
- See the **express** skill for error forwarding conventions
