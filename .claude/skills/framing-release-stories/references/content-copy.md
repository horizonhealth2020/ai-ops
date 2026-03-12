# Content Copy Reference

## Contents
- Voice and Tone Principles
- Vertical-Specific Copy Patterns
- Dashboard Copy Touchpoints
- Agent Persona Change Announcements
- WARNING: Generic SaaS Copy

---

## Voice and Tone Principles

AI Ops serves HVAC techs, plumbers, electricians, spa owners, and restaurant managers — not
developers. Copy must be written at a 7th-grade reading level, use trade language, and avoid
any technical jargon from the stack.

| Principle | Right | Wrong |
|-----------|-------|-------|
| Trade-specific | "For your HVAC business" | "For your business" |
| Concrete outcomes | "Books 3x faster" | "Improved efficiency" |
| Active voice | "Your agent books the appointment" | "Appointments can be booked" |
| No jargon | "Your agent remembers repeat callers" | "pgvector caller memory injection" |
| Wallet-aware | "Your $40 balance covers ~100 minutes" | "Billing is usage-based" |

---

## Vertical-Specific Copy Patterns

Reference `seeds/demo_clients.sql` for the three canonical verticals: HVAC, spa, electrical.

```sql
-- seeds/demo_clients.sql — three reference verticals
-- Apex Plumbing & HVAC    (+19545550100) → housecall_pro
-- Zen Day Spa             (+13055550200) → google_calendar
-- Elite Electrical Solutions (+19545550300) → jobber
```

**HVAC / Plumbing / Electrical — copy pattern:**
```markdown
Your agent handles the dispatch calls so you're focused on the job,
not the phone.

When a homeowner calls about a broken AC:
- Agent checks your open slots
- Books the service call into [HouseCall Pro / Jobber]
- Tells them a tech will be there [date/time]

You get the job. They get confirmation. Nobody waits on hold.
```

**Spa — copy pattern:**
```markdown
Your agent books treatments and answers service questions while
you're with a client.

Callers hear a professional voice, get their appointment confirmed,
and receive a reminder — all without interrupting your session.
```

**Electrical — copy pattern:**
```markdown
Your agent qualifies the job type (panel upgrade, outlet repair, EV charger)
before booking, so your techs arrive with the right parts.
```

---

## Dashboard Copy Touchpoints

The dashboard serves three `GET/PUT` endpoint groups. Each has its own copy surface:

```javascript
// src/routes/dashboard.js — copy touchpoints
// GET  /api/v1/dashboard/config   → "Your current setup"
// PUT  /api/v1/dashboard/hours    → "Business hours" section
// PUT  /api/v1/dashboard/agent    → "Agent persona" section
// GET  /api/v1/dashboard/calls    → "Call history" / "Recent calls"
// GET  /api/v1/dashboard/wallet   → "Balance" + "Transaction history"
```

**Business hours update confirmation copy:**
```markdown
Hours updated. Your agent now uses these times to determine when
to offer bookings vs. when to take a message.
```

**Agent persona update confirmation copy:**
```markdown
Agent updated. New name and tone active on the next incoming call.
Changes take effect immediately — no restart needed.
```

**Zero-balance wallet copy:**
```markdown
Your balance is $0. Your agent can still answer calls and take messages,
but cannot book appointments or process payments.

Add funds → agent resumes full service on the next call.
```

---

## Agent Persona Change Announcements

When shipping changes to `src/services/promptCompiler.js` or the agent persona fields,
launch copy must explain what the operator can customize and what they can't.

```javascript
// src/services/promptCompiler.js — what gets compiled into system_prompt
// - business name, vertical, services list
// - agent name and tone (friendly/professional/casual)
// - business hours and timezone
// - payment processor configured
// - FSM integration type
// Compiled once on config edit, stored in clients.system_prompt
```

**Persona feature launch:**
```markdown
## Customize Your Agent's Name and Tone

Your agent can now introduce itself by name and match your shop's personality.

Options:
- Name: anything — "Alex", "Dispatch", your business name
- Tone: Professional (formal), Friendly (warm), Casual (laid-back)

Set it in Dashboard → Agent → Persona.
Change takes effect immediately on the next call.
```

---

## WARNING: Generic SaaS Copy

**The Problem:**

```markdown
// BAD - could describe any SaaS product
Our AI-powered platform leverages cutting-edge technology to streamline
your business operations and improve customer engagement.
```

**Why This Breaks:**
1. HVAC owners receive dozens of pitches like this — it signals a generic tool
2. Zero specificity = zero trust from trade business owners
3. Misses the emotional hook: they hate missing calls while on a job

**The Fix:**

```markdown
// GOOD - specific to the trade, specific to the pain
A plumber can't answer the phone from under a sink.
Your AI agent answers every call, books the job, and sends a confirmation —
while you're finishing the work you're already paid for.
```

**When You Might Be Tempted:**
When writing copy for a general platform update that affects all verticals, the temptation
is to write broad. Instead, write one version per vertical and rotate by audience segment,
or pick the primary vertical (HVAC) and note it applies to all trades.

---

## Changelog Entry Format

For entries that go into a public changelog (tied to the **writing-release-notes** skill):

```markdown
### [Date] — [Feature Name]

**What's new:** [One sentence. What the operator can now do.]
**Who gets it:** [All clients / HVAC clients / Growth+ plans]
**Action required:** [None / Dashboard → X → Y]

[Optional: 1-2 sentence explanation of what changed under the hood, in plain language]
```

See the **writing-release-notes** skill for versioning conventions.
See the **crafting-page-messaging** skill for updating in-dashboard copy surfaces.
