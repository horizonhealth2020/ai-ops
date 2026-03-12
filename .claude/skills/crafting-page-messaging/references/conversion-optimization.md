# Conversion Optimization Reference

## Contents
- Call completion rate — the primary conversion metric
- Wallet soft-lock path
- Booking rejection recovery
- Anti-patterns that kill completion rate
- Checklist

---

## Call Completion Rate — The Primary Conversion Metric

A "conversion" in AI Ops is a call that ends with a booked appointment or payment — not a
hang-up. Every copy decision must be evaluated against this. The two paths with the highest
drop risk are the wallet soft-lock and the booking-slot rejection.

---

## Wallet Soft-Lock Path (src/services/walletService.js)

When `wallet_balance <= 0`, the agent switches to message-only mode. The script here
determines whether the caller leaves a callback or hangs up.

```javascript
// GOOD — neutral, keeps caller engaged
const SOFT_LOCK_SCRIPT =
  "I can take a message and have someone from the team follow up with you today. " +
  "Can I get your name and best callback number?";

// BAD — tells caller the agent is broken, triggers hang-up
const BAD_SCRIPT = "Our AI system is currently unavailable. Please try again later.";
```

**Why the bad version fails:** "Try again later" is a dead end. Callers calling a trade
business have an urgent need (broken AC, burst pipe). They'll call a competitor.

---

## Booking Rejection Recovery (src/services/bookingService.js)

When Redis `SETNX` fails (slot taken) or FSM rejects the booking, always present alternatives.
Never return a bare "slot unavailable" message.

```javascript
// GOOD — always offer at least 2 alternatives
function buildRejectionScript(altSlots) {
  if (altSlots.length === 0) {
    return "We're fully booked this week. Can I get your number and have us call you " +
           "the moment something opens up?";
  }
  return `That time just got taken. I have ${altSlots[0]} or ${altSlots[1]} available. ` +
         `Which works for you?`;
}

// BAD — dead-ends the caller
res.json({ message: "No slots available." });
```

---

## Payment SMS Link Copy (src/integrations/twilio.js)

The SMS sent after `POST /api/v1/payment/create-intent` is the last touch before payment.

```javascript
// GOOD — specific amount, clear action, short URL
const smsBody =
  `Hi ${callerName}, here's your secure payment link for $${amountFormatted}: ${paymentUrl} ` +
  `It expires in 15 minutes.`;

// BAD — generic, no urgency
const badSms = `Click here to pay: ${paymentUrl}`;
```

Urgency ("expires in 15 minutes") increases tap-through. Personalization reduces abandonment.

---

## Onboarding Confirmation (src/routes/onboard.js)

The `POST /api/v1/onboard` response is what a new operator sees immediately after signup.
This sets their activation expectation.

```javascript
// GOOD — specific next step, time-bound expectation
res.status(201).json({
  success: true,
  message: "Agent configured. You'll receive a test call within 10 minutes.",
  next_steps: [
    "Confirm your business hours at /api/v1/dashboard/hours",
    "Add at least one transfer number before going live",
  ],
});

// BAD — vague, no next action
res.status(201).json({ success: true, message: "Account created." });
```

---

## WARNING: Dead-End Error Responses

**The Problem:**
```javascript
// BAD — no path forward for the caller
res.json({ error: "Booking failed." });
```

**Why This Breaks:**
1. Agent has no fallback script — Vapi reads raw JSON, producing a robotic message
2. Caller hangs up; call logged as incomplete; wallet still partially billed
3. Operator sees a failed call log with no actionable detail

**The Fix:**
```javascript
// GOOD — structured for both agent consumption and operator logging
res.json({
  success: false,
  script: "I wasn't able to lock that appointment. Let me find you the next available time.",
  alternatives: altSlots,
  reason_code: "slot_conflict",  // for operator dashboard, never read aloud
});
```

---

## Conversion Copy Checklist

Copy this checklist when writing any agent-facing or operator-facing message:

- [ ] Does the agent script avoid exposing system state (Redis, DB, FSM errors)?
- [ ] Does every rejection offer a next action (alternatives, callback, message)?
- [ ] Is the message under 30 words? (voice readability)
- [ ] Does the SMS include amount, action, and urgency?
- [ ] Does the onboarding response include a time-bound expectation?
- [ ] Is the operator error message actionable (not just "something went wrong")?
