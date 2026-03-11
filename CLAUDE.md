# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Ops is a multi-tenant AI voice agent SaaS platform for blue-collar service businesses (HVAC, plumbing, electrical, spa, restaurant, cleaning). One codebase serves all clients. Each client gets an AI phone agent that answers calls, books appointments, takes payments, and remembers callers.

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** PostgreSQL + pgvector (via PgBouncer)
- **Cache/State:** Redis (soft locks, config cache, OAuth tokens, rate limiting)
- **Voice AI:** Vapi (custom LLM provider endpoint)
- **Payments:** Stripe + Square (client-specific credentials)
- **SMS:** Twilio (platform account, not per-client)
- **Auth:** Clerk (client dashboard)
- **Workflow Automation:** n8n (async post-call processing)
- **FSM Integrations:** HouseCall Pro, Jobber, ServiceTitan
- **Hosting:** Railway (PostgreSQL, Redis, PgBouncer as Railway services)

## Architecture Principles

1. **Multi-tenant by phone number.** Every inbound call includes a `to` phone number. Look up `client_id` from that number. Every query MUST include `client_id` — data isolation is non-negotiable.
2. **Stateless Express API.** No in-memory state. All state lives in Redis (ephemeral) or PostgreSQL (persistent). This allows horizontal scaling with multiple Railway replicas.
3. **Redis is ephemeral, PostgreSQL is truth.** If Redis dies, soft locks release (safe — slots become available), config caches reload from PostgreSQL, OAuth tokens refresh on next API call. No data loss possible.
4. **Real-time vs async split.** Anything the AI agent needs during a live call goes through Express (fast). Anything that happens after the call goes through n8n webhooks (async).
5. **System prompts are pre-compiled.** Store the assembled prompt in `clients.system_prompt`. Only append caller context and current time at call time. Regenerate on config edit, not on every call.
6. **All money in cents (integers).** Never use floating point for currency.
7. **Phone numbers in E.164 format.** Always `+1XXXXXXXXXX`.
8. **Dual-path payment pattern.** Both Stripe and Square follow identical flows: real-time intent creation via Express during calls, async reconciliation via n8n post-payment.
9. **Credentials encrypted at rest.** All FSM/payment API keys stored in `client_integrations.credentials_encrypted` using AES-256.

## Project Structure

```
aiops-backend/
├── src/
│   ├── index.js                  # Express app entry point
│   ├── config/
│   │   ├── database.js           # PgBouncer pool config
│   │   ├── redis.js              # Redis client
│   │   └── env.js                # Environment variable validation
│   ├── middleware/
│   │   ├── auth.js               # Clerk JWT verification (dashboard routes)
│   │   ├── rateLimiter.js        # Redis-based rate limiting
│   │   ├── tenantResolver.js     # Resolve client_id from request context
│   │   └── errorHandler.js       # Global error handler
│   ├── routes/
│   │   ├── vapi.js               # /api/v1/context/inject (custom LLM provider)
│   │   ├── availability.js       # /api/v1/availability/* (check, hold, release)
│   │   ├── booking.js            # /api/v1/booking/create
│   │   ├── payment.js            # /api/v1/payment/create-intent
│   │   ├── call.js               # /api/v1/call/* (transfer, complete)
│   │   ├── dashboard.js          # /api/v1/dashboard/* (client self-service)
│   │   ├── onboard.js            # /api/v1/onboard (intake form webhook)
│   │   └── health.js             # /health (Railway healthcheck)
│   ├── services/
│   │   ├── promptBuilder.js      # Assemble system prompt from client config
│   │   ├── availabilityService.js # Cache reads + Redis hold logic
│   │   ├── bookingService.js     # FSM verification + booking creation
│   │   ├── paymentService.js     # Stripe/Square intent creation
│   │   ├── transferService.js    # Call transfer logic
│   │   ├── walletService.js      # Prepaid balance check/deduct/reload
│   │   ├── faqSearch.js          # pgvector similarity search for FAQs
│   │   ├── callerMemory.js       # Lookup caller by phone, inject history
│   │   └── encryption.js         # AES-256 encrypt/decrypt credentials
│   ├── integrations/
│   │   ├── housecallpro.js       # HouseCall Pro API client
│   │   ├── jobber.js             # Jobber GraphQL client
│   │   ├── servicetitan.js       # ServiceTitan OAuth2 + REST client
│   │   ├── stripe.js             # Stripe payment intent creation
│   │   ├── square.js             # Square payment intent creation
│   │   └── twilio.js             # SMS sending (payment links, notifications)
│   └── utils/
│       ├── timeUtils.js          # Business hours checking, timezone handling
│       ├── formatters.js         # Phone formatting, price formatting
│       └── logger.js             # Structured logging
├── migrations/                   # PostgreSQL migrations (sequential numbered)
├── seeds/
│   └── demo_clients.sql          # Demo clients with full configs
├── .env.example
├── Dockerfile
├── railway.toml
├── package.json
└── README.md
```

## Database Connection

Always connect through PgBouncer, never directly to PostgreSQL. Use `pg` library with pool:

```javascript
const pool = new Pool({ connectionString: process.env.PGBOUNCER_URL });
```

## Redis Key Patterns

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `hold:{client_id}:{date}:{time}` | STRING | 300s | Soft-lock for appointment slot |
| `held_slots:{client_id}` | SET | 300s | All currently held slots (for availability filtering) |
| `call_holds:{call_id}` | STRING | 300s | Maps call to its active hold |
| `client_config:{client_id}` | STRING | 300s | Cached client config JSON |
| `st_token:{client_id}` | STRING | 3500s | ServiceTitan OAuth2 token cache |
| `rate_limit:{client_id}:{endpoint}` | STRING | 60s | Rate limiting counter |

## Booking Flow (3-Phase Soft-Lock)

1. **Check Availability** (`POST /api/v1/availability/check`) — Read `cached_availability` from PostgreSQL via PgBouncer. Filter out slots in `held_slots:{client_id}` Redis set. Return available slots. ~150ms.
2. **Soft-Lock Slot** (`POST /api/v1/availability/hold`) — Redis `SETNX` on `hold:{client_id}:{date}:{time}` with 300s TTL. Atomic — if another call holds it first, return alternatives. ~30ms.
3. **Confirm Booking** (`POST /api/v1/booking/create`) — Hit FSM API to verify slot externally. If confirmed, write to PostgreSQL `bookings` table, clear Redis hold, fire n8n webhook. If rejected, return fallback message with alternatives. ~500ms.

## Code Style

- Use `async/await` everywhere, never raw callbacks
- Wrap all route handlers in try/catch with next(error)
- Use parameterized queries ($1, $2) for all SQL — never string interpolation
- Log with structured JSON: `{ level, message, client_id, call_id, duration_ms }`
- Keep route handlers thin — business logic lives in `/services`
- Validate all incoming request bodies at the route level

## Environment Variables

```
# Database
PGBOUNCER_URL=postgresql://...
DATABASE_URL=postgresql://... (direct, for migrations only)

# Redis
REDIS_URL=redis://...

# Vapi
VAPI_API_KEY=...

# OpenAI (for LLM proxy)
OPENAI_API_KEY=...

# Stripe (platform account)
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Twilio (platform account)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...

# Clerk (dashboard auth)
CLERK_SECRET_KEY=...

# n8n
N8N_WEBHOOK_BASE_URL=...

# Encryption
ENCRYPTION_KEY=... (32-byte hex for AES-256)

# App
PORT=3000
NODE_ENV=production
```

## Testing

- Write integration tests for the booking flow (the most critical path)
- Test concurrent hold attempts to verify Redis SETNX prevents double-booking
- Test FSM verification failure path (agent should gracefully offer alternatives)
- Test wallet balance check (call should not proceed if balance is $0)

## Deployment

Railway auto-deploys from GitHub main branch. The `railway.toml` configures the healthcheck and start command. Never commit `.env` — use Railway's environment variable UI.
