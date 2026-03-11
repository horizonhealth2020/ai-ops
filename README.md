# AI Ops Backend

Multi-tenant AI voice agent SaaS backend for blue-collar service businesses (HVAC, plumbing, electrical, spa, restaurant, cleaning). Acts as a custom LLM provider for [Vapi](https://vapi.ai), handling inbound call routing, dynamic prompt assembly, appointment booking, payments, and FSM integration.

```
Caller ──► Vapi ──POST /api/v1/context/inject──► This Server ──► OpenAI
                         (OpenAI format)              │
                                                      ├── PostgreSQL (clients, bookings, wallets)
                                                      ├── Redis (slot holds, config cache)
                                                      ├── FSM (HouseCall Pro / Jobber / ServiceTitan)
                                                      ├── Stripe / Square (payments)
                                                      └── n8n (async post-call workflows)
                         ◄── SSE stream ──────────────┘
```

## Features

- **Multi-tenant** — each client identified by phone number or metadata `client_id`
- **Prepaid wallet billing** — tiered per-minute pricing (standard/growth/scale/enterprise)
- **3-phase soft-lock booking** — check → hold (Redis SETNX) → confirm (FSM verify + PostgreSQL)
- **Dual payment processors** — Stripe + Square with SMS payment links via Twilio
- **FSM integrations** — HouseCall Pro, Jobber, ServiceTitan (encrypted credentials per client)
- **pgvector FAQ search** — semantic similarity search injected into context
- **Returning caller recognition** — caller history from call logs
- **Pre-compiled system prompts** — stored in DB, regenerated on config edit
- **Railway-ready** — `railway.toml` + `Dockerfile` included

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd aiops-backend
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — set PGBOUNCER_URL, REDIS_URL, VAPI_API_KEY, OPENAI_API_KEY

# 3. Run database migrations
npm run migrate

# 4. Seed demo data
npm run seed

# 5. Start
npm run dev
```

---

## Deploy to Railway

1. Push to GitHub
2. Railway → **New Project** → **Deploy from GitHub**
3. Add **PostgreSQL**, **Redis**, and **PgBouncer** services
4. Set environment variables (see `.env.example`)
5. Railway auto-detects `railway.toml`
6. After deploy: `railway run npm run migrate && railway run npm run seed`

---

## Configuring Vapi

1. Vapi dashboard → **Providers** → **Custom LLM**
2. URL: `https://YOUR_RAILWAY_URL/api/v1/context/inject`
3. Auth: Bearer token = your `VAPI_API_KEY`
4. In assistant metadata, set `client_id` to the client's UUID

---

## Billing

Prepaid wallet system with tiered per-minute pricing:

| Tier | Rate |
|------|------|
| Standard | $0.40/min |
| Growth | $0.32/min |
| Scale | $0.27/min |
| Enterprise | $0.23/min |

Deducted on call complete. If wallet balance is $0, agent switches to message-only mode.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check (PG + Redis) |
| `POST` | `/api/v1/context/inject` | Vapi | Custom LLM endpoint (SSE streaming) |
| `POST` | `/api/v1/availability/check` | Vapi | Check available slots |
| `POST` | `/api/v1/availability/hold` | Vapi | Soft-lock a slot (5 min TTL) |
| `DELETE` | `/api/v1/availability/hold/:id` | Vapi | Release a held slot |
| `POST` | `/api/v1/booking/create` | Vapi | Create booking with FSM verification |
| `POST` | `/api/v1/payment/create-intent` | Vapi | Create payment intent + SMS link |
| `POST` | `/api/v1/call/transfer` | Vapi | Get transfer config |
| `POST` | `/api/v1/call/complete` | Vapi | Log call, deduct wallet, release holds |
| `POST` | `/api/v1/onboard` | None | Create new client from intake form |
| `GET` | `/api/v1/dashboard/config` | Clerk | Get full client config |
| `PUT` | `/api/v1/dashboard/hours` | Clerk | Update business hours |
| `PUT` | `/api/v1/dashboard/scheduling` | Clerk | Update scheduling config |
| `PUT` | `/api/v1/dashboard/agent` | Clerk | Update agent persona |
| `GET` | `/api/v1/dashboard/calls` | Clerk | Paginated call logs (filterable) |
| `GET` | `/api/v1/dashboard/wallet` | Clerk | Wallet balance + transactions |

---

## Demo Clients (from seeds)

| Company | Phone | Vertical | FSM |
|---------|-------|----------|-----|
| Apex Plumbing & HVAC | +19545550100 | hvac | HouseCall Pro |
| Zen Day Spa | +13055550200 | spa | Google Calendar |
| Elite Electrical Solutions | +19545550300 | electrical | Jobber |

---

## Adding a New FSM Integration

1. Create `src/integrations/yourfsm.js` — implement `verifySlotAvailability()`, `createJob()`, `searchCustomer()`
2. Add to `FSM_ADAPTERS` in `src/services/bookingService.js`
3. Store encrypted credentials in `client_integrations` table
