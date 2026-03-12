# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Ops is a multi-tenant AI voice agent SaaS platform for blue-collar service businesses (HVAC, plumbing, electrical, spa, restaurant, cleaning). One codebase serves all clients. Each client gets an AI phone agent that answers calls, books appointments, takes payments, and remembers callers.

## Tech Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Node.js | 18+ | Server runtime |
| Framework | Express | 4.18+ | REST API and middleware |
| Database | PostgreSQL | 15+ | Persistent storage (via PgBouncer) |
| Vector DB | pgvector | 0.2+ | Semantic FAQ search |
| Cache/State | Redis | 7+ | Soft locks, config cache, OAuth tokens |
| Voice AI | Vapi | Latest | Custom LLM provider integration |
| LLM | OpenAI | 4.47+ | GPT-4o for dynamic prompt generation |
| Payments | Stripe + Square | Latest | Dual-path payment processing |
| SMS | Twilio | 5.0+ | Payment links and notifications |
| Auth | Clerk | 1.0+ | Dashboard JWT verification |
| Workflow | n8n | Latest | Async post-call webhooks |
| FSM APIs | HouseCall Pro, Jobber, ServiceTitan | Native | Field service management integrations |
| Hosting | Railway | Latest | Managed PostgreSQL, Redis, PgBouncer |

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

## Quick Start

```bash
# Prerequisites
node --version  # v18 or higher
npm install -g npm

# Clone and install
git clone <repo-url>
cd aiops-backend
npm install

# Set up environment
cp .env.example .env
# Edit .env with your actual values (see Environment Variables section)

# Database setup
npm run migrate
npm run seed

# Start development server
npm run dev
```

Server runs on `http://localhost:3000` by default.

## Project Structure

```
aiops-backend/
├── src/
│   ├── index.js                  # Express app entry point + graceful shutdown
│   ├── config/
│   │   ├── database.js           # PgBouncer connection pool
│   │   ├── redis.js              # Redis client initialization
│   │   └── env.js                # Environment validation and defaults
│   ├── middleware/
│   │   ├── auth.js               # Clerk JWT + Vapi API key verification
│   │   ├── rateLimiter.js        # Redis-based rate limiting per client
│   │   ├── tenantResolver.js     # Extract and validate client_id from request
│   │   └── errorHandler.js       # Global error handler with structured logging
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
│   │   ├── promptBuilder.js      # Append caller context to pre-compiled prompt
│   │   ├── promptCompiler.js     # Compile system prompt from all config fields
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
│   │   ├── stripe.js             # Stripe payment intent + webhook handling
│   │   ├── square.js             # Square payment intent + webhook handling
│   │   └── twilio.js             # SMS sending (payment links, notifications)
│   └── utils/
│       ├── timeUtils.js          # Business hours checking, timezone handling
│       ├── formatters.js         # Phone, price, date formatting
│       └── logger.js             # Structured JSON logging
├── scripts/
│   ├── migrate.js                # Database migrations (PostgreSQL direct)
│   └── seed.js                   # Demo data seeding
├── migrations/                   # SQL migration files (numbered sequentially)
├── seeds/
│   └── demo_clients.sql          # Demo client configuration
├── .env.example                  # Environment variable template
├── Dockerfile                    # Docker image for Railway
├── railway.toml                  # Railway deployment config
├── package.json                  # Dependencies and npm scripts
└── README.md                     # Public project documentation
```

## Code Style & Conventions

### File Naming
- **Files:** camelCase (e.g., `bookingService.js`, `availabilityService.js`, `housecallpro.js`)
- **Directories:** lowercase (e.g., `/middleware`, `/routes`, `/services`)
- **No TypeScript:** Project uses plain JavaScript with `'use strict'` at top of each file

### Code Naming
- **Variables & functions:** camelCase (e.g., `const clientId`, `function checkAvailability()`)
- **Constants:** SCREAMING_SNAKE_CASE (e.g., `const MAX_RETRIES = 3`)
- **Classes/Constructors:** PascalCase (if used — rare in this codebase)
- **Private fields:** _prefix convention (e.g., `this._cache`)
- **Booleans:** is/has/should prefix (e.g., `isActive`, `hasPermission`)

### Code Patterns

**Async/Await & Error Handling:**
```javascript
// ✅ Correct
router.post('/endpoint', async (req, res, next) => {
  try {
    const result = await someService.action(data);
    res.json(result);
  } catch (err) {
    next(err);  // Pass to global error handler
  }
});

// ❌ Avoid
router.post('/endpoint', (req, res) => {
  someService.action(data)
    .then(result => res.json(result))
    .catch(err => res.status(500).json({ error: err.message }));
});
```

**Database Queries:**
```javascript
// ✅ Correct - parameterized queries
const result = await pool.query(
  'SELECT * FROM clients WHERE client_id = $1 AND is_active = $2',
  [clientId, true]
);

// ❌ Avoid - string interpolation
const result = await pool.query(
  `SELECT * FROM clients WHERE client_id = '${clientId}'`
);
```

**Structured Logging:**
```javascript
// ✅ Correct - JSON structure with metadata
logger.info('Booking created', { client_id: clientId, booking_id: id, duration_ms: 234 });

// ❌ Avoid
console.log('Booking created for', clientId);
```

**Module Exports:**
```javascript
// ✅ Correct
module.exports = router;
module.exports = { checkAvailability, holdSlot };

// ❌ Avoid - ES6 exports not used in this project
export const checkAvailability = () => {};
```

## Database Connection

Always connect through PgBouncer, never directly to PostgreSQL.

```javascript
const pool = new Pool({ connectionString: process.env.PGBOUNCER_URL });
```

- **PgBouncer (PGBOUNCER_URL):** Used by all application routes and services (~150ms latency, pooled)
- **Direct PostgreSQL (DATABASE_URL):** Used ONLY by migration scripts, never in app code

## Redis Key Patterns

All Redis keys are namespaced by `client_id` or `call_id` for multi-tenant safety.

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `hold:{client_id}:{date}:{time}` | STRING | 300s | Soft-lock for appointment slot |
| `held_slots:{client_id}` | SET | 300s | All currently held slots (for availability filtering) |
| `call_holds:{call_id}` | STRING | 300s | Maps call to its active hold |
| `client_config:{client_id}` | STRING | 300s | Cached client config JSON |
| `st_token:{client_id}` | STRING | 3500s | ServiceTitan OAuth2 token cache |
| `rate_limit:{client_id}:{endpoint}` | STRING | 60s | Rate limiting counter |

## Booking Flow (3-Phase Soft-Lock)

This is the **most critical flow** — handles concurrent calls attempting to book the same slot atomically.

1. **Check Availability** (`POST /api/v1/availability/check`)
   - Read `cached_availability` from PostgreSQL via PgBouncer
   - Filter out slots in `held_slots:{client_id}` Redis set
   - Return available slots
   - ~150ms

2. **Soft-Lock Slot** (`POST /api/v1/availability/hold`)
   - Redis `SETNX` on `hold:{client_id}:{date}:{time}` with 300s TTL
   - Atomic — if another call holds it first, return alternatives
   - Add to `held_slots:{client_id}` set for immediate filtering
   - ~30ms

3. **Confirm Booking** (`POST /api/v1/booking/create`)
   - Hit FSM API to verify slot availability externally
   - If confirmed: write to PostgreSQL `bookings` table, clear Redis hold, fire n8n webhook
   - If rejected: return fallback message with alternative slots
   - ~500ms

**Critical:** Redis holds expire automatically after 300s. If a client abandons a call, the slot automatically becomes available.

## Environment Variables

### Required (must be set before startup)
| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `PGBOUNCER_URL` | string | PostgreSQL pooler connection string | postgresql://user:pass@host:6432/dbname |
| `REDIS_URL` | string | Redis connection string | redis://default:pass@host:6379 |
| `VAPI_API_KEY` | string | Vapi API key for authentication | vapi_sk_... |
| `OPENAI_API_KEY` | string | OpenAI API key for LLM | sk-... |

### Optional (have defaults, but recommended for production)
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `NODE_ENV` | development | Set to `production` for Railway |
| `OPENAI_MODEL` | gpt-4o | OpenAI model to use |
| `DB_SSL` | false | Set to true for RDS/managed databases |

### Payment Integrations (optional, required only if using that processor)
| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `SQUARE_ACCESS_TOKEN` | Square API access token |

### Communication (optional, required only if using)
| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account ID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Platform phone number for SMS |
| `CLERK_SECRET_KEY` | Clerk API secret for dashboard auth |

### Integrations & Workflows
| Variable | Description |
|----------|-------------|
| `N8N_WEBHOOK_BASE_URL` | n8n instance base URL for async webhooks |
| `ENCRYPTION_KEY` | 32-byte hex string for AES-256 encryption |
| `DATABASE_URL` | Direct PostgreSQL connection (migrations only) |

## Available npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `nodemon src/index.js` | Start development server with auto-reload |
| `start` | `node src/index.js` | Start production server |
| `migrate` | `node scripts/migrate.js` | Run database migrations |
| `seed` | `node scripts/seed.js` | Seed demo client data |

## Testing Strategy

### Unit Tests (to implement)
- Individual service functions (promptBuilder, walletService, etc.)
- Mock external APIs (Stripe, Twilio, FSM)
- Test encryption/decryption with sample data

### Integration Tests (critical)
- **Booking flow:** Test concurrent `hold` requests to verify atomic SETNX prevents double-booking
- **Payment flow:** Test Stripe/Square intent creation with mocked webhooks
- **FSM verification:** Test slot availability checks with mocked external APIs
- **Wallet balance:** Verify call rejection when balance is $0

### Test Patterns
- Use mocked Redis/PostgreSQL for speed
- Test concurrent scenarios (race conditions in booking)
- Test FSM verification failure path (agent should gracefully offer alternatives)
- Test timeout scenarios (external API slow response)

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Examples:
- `feat(booking): implement 3-phase soft-lock` — new feature
- `fix(wallet): prevent negative balance deduction` — bug fix
- `refactor(services): extract FSM adapter logic` — code restructuring
- `test(booking): add concurrent hold race condition tests` — test addition
- `docs(README): clarify booking flow` — documentation

Keep subject line under 50 characters. Use imperative mood ("implement" not "implemented").

## Deployment

### Local Development

```bash
# 1. Start PostgreSQL (Docker)
docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:15

# 2. Start Redis (Docker)
docker run --name redis -p 6379:6379 redis:7

# 3. Set up environment
cp .env.example .env
# Edit .env with local credentials (postgres://localhost, redis://localhost)

# 4. Run migrations & seed
npm run migrate
npm run seed

# 5. Start server
npm run dev
```

### Railway Deployment

1. Push to GitHub
2. Railway → **New Project** → **Deploy from GitHub**
3. Add **PostgreSQL**, **Redis**, and **PgBouncer** services
4. Set environment variables (see `.env.example` for required vars)
5. Railway auto-detects `railway.toml` and starts healthcheck
6. After deploy: `railway run npm run migrate && railway run npm run seed`

**Important:** Railway auto-provides `PGBOUNCER_URL` as a plugin. Never commit `.env` — use Railway's environment variable UI.

## Adding a New FSM Integration

1. Create `src/integrations/yourfsm.js` — implement these methods:
   - `verifySlotAvailability(credentials, clientId, date, time)` — return boolean
   - `createJob(credentials, clientId, booking)` — return job ID
   - `searchCustomer(credentials, clientId, phone)` — return customer record

2. Register in `bookingService.js`:
   ```javascript
   const FSM_ADAPTERS = {
     housecall_pro: () => require('../integrations/housecallpro'),
     jobber: () => require('../integrations/jobber'),
     servicetitan: () => require('../integrations/servicetitan'),
     yourfsm: () => require('../integrations/yourfsm'),  // Add here
   };
   ```

3. Store encrypted credentials in `client_integrations` table with `integration_type = 'fsm'`

## Key Files to Know

| File | Purpose | When to Edit |
|------|---------|--------------|
| `src/index.js` | App bootstrap + graceful shutdown | Adding new middleware or routes |
| `src/routes/*.js` | API endpoint handlers | Adding/modifying API endpoints |
| `src/services/*.js` | Business logic (bookings, payments, etc.) | Implementing core features |
| `src/integrations/*.js` | External API clients (Stripe, Vapi, FSM) | Integrating new services |
| `src/middleware/auth.js` | Vapi + Clerk JWT verification | Modifying auth logic |
| `src/config/env.js` | Environment variable validation | Adding new required env vars |
| `migrations/` | SQL schema changes | Database schema updates |
| `.env.example` | Environment variable documentation | Adding new env vars |

---

**For complete API endpoint documentation,** see @README.md
**For business logic decisions,** see architecture principles at top of this file


## Skill Usage Guide

When working on tasks involving these technologies, invoke the corresponding skill:

| Skill | Invoke When |
|-------|-------------|
| redis | Caches config, manages soft-lock appointment holds, persists ephemeral state |
| postgresql | Manages database schema, migrations, and multi-tenant data isolation |
| openai | Integrates GPT-4o for dynamic prompt assembly and LLM completions |
| express | Builds REST API routes with middleware, RBAC, and error handling |
| stripe | Handles payment intents, webhooks, and dual-path payment processing |
| square | Processes Square payment intents and generates SMS payment links |
| node | Runs Express API, async handlers, middleware, and server runtime |
| twilio | Sends SMS notifications, payment links, and customer communications |
| pgvector | Performs semantic vector search on FAQ knowledge base |
| vapi | Integrates voice AI provider and streams custom LLM context via SSE |
| clerk | Verifies JWT tokens and provides dashboard authentication |
| scoping-feature-work | Breaks features into MVP slices and acceptance criteria |
| designing-onboarding-paths | Designs onboarding paths, checklists, and first-run UI |
| crafting-empty-states | Creates empty states and onboarding affordances |
| orchestrating-feature-adoption | Plans feature discovery, nudges, and adoption flows |
| mapping-user-journeys | Maps in-app journeys and identifies friction points in code |
| instrumenting-product-metrics | Defines product events, funnels, and activation metrics |
| designing-inapp-guidance | Builds tooltips, tours, and contextual guidance |
| writing-release-notes | Drafts release notes tied to shipped features |
| running-product-experiments | Sets up product experiments and rollout checks |
| triaging-user-feedback | Routes feedback into backlog and quick wins |
| tightening-brand-voice | Refines copy for clarity, tone, and consistency |
| mapping-conversion-events | Defines funnel events, tracking, and success signals |
| tuning-landing-journeys | Improves landing page flow, hierarchy, and conversion paths |
| streamlining-signup-steps | Reduces friction in signup and trial activation |
| accelerating-first-run | Improves onboarding sequence and time-to-value |
| strengthening-upgrade-moments | Improves upgrade prompts and paywall messaging |
| inspecting-search-coverage | Audits technical and on-page search coverage |
