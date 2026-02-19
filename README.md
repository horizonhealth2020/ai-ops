# AI Ops Backend

Multi-tenant AI voice agent backend for field service companies (HVAC, Plumbing, Spa). Acts as a custom LLM provider for [Vapi](https://vapi.ai), handling inbound call routing, dynamic prompt assembly, tool execution, and CRM integration.

```
Vapi ──POST /vapi/chat──► This Server ──► LLM (any provider)
        (OpenAI format)         │              ↕ tool loop
                                │         CRM (ServiceTitan/stub) · Stripe
                                ◄── SSE stream ─────────────────────────────
```

## Features

- **Multi-tenant** — each client identified by their inbound Vapi phone number
- **Provider-agnostic LLM** — OpenAI, Groq, Together AI, Mistral, Ollama, Anthropic, or any OpenAI-compatible endpoint
- **Dynamic prompt assembly** — industry templates (HVAC/Plumbing/Spa) merged with per-client config
- **Agentic tool loop** — availability checks, job creation, customer lookup, Stripe payments, warm transfers
- **ServiceTitan CRM** — OAuth2 authenticated; stub adapter for development
- **Railway-ready** — `railway.toml` included

---

## Quick Start (Local)

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/aiops-backend.git
cd aiops-backend
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — set DATABASE_URL, VAPI_SECRET, LLM_PROVIDER + LLM_API_KEY, STRIPE_SECRET_KEY

# 3. Set up database
psql $DATABASE_URL < schema.sql
psql $DATABASE_URL < seed.sql

# 4. Start
npm run dev
```

---

## Deploy to Railway

1. Push this repo to GitHub
2. In [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Add a **PostgreSQL** addon to the project
4. Set environment variables (Settings → Variables):
   - `DATABASE_URL` — auto-filled by Railway PostgreSQL addon
   - `VAPI_SECRET`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `STRIPE_SECRET_KEY`
5. Railway detects `railway.toml` automatically — deploy runs `npm install` then `node src/server.js`
6. After deploy, run the schema and seed against your Railway DB:
   ```bash
   railway run psql $DATABASE_URL < schema.sql
   railway run psql $DATABASE_URL < seed.sql
   ```

---

## Configuring Vapi

1. In Vapi dashboard → **Providers** → **Custom LLM**
2. Set **URL** to `https://YOUR_RAILWAY_URL/vapi/chat`
3. Set **Auth** to Bearer token → value = your `VAPI_SECRET`
4. Set **Webhook URL** to `https://YOUR_RAILWAY_URL/vapi/webhook`
5. Assign the custom LLM to your assistant or phone number

---

## LLM Providers

Set `LLM_PROVIDER` + `LLM_API_KEY` + `LLM_MODEL` in your environment:

| Provider | LLM_PROVIDER | Example Model |
|---|---|---|
| OpenAI | `openai` | `gpt-4o` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| Together AI | `together` | `meta-llama/Llama-3-70b-chat-hf` |
| Mistral | `mistral` | `mistral-large-latest` |
| Anthropic | `anthropic` | `claude-opus-4-6` |
| Ollama (local) | `ollama` | `llama3.2` (+ set `LLM_BASE_URL=http://localhost:11434/v1`) |
| Custom endpoint | `custom` | your model (+ set `LLM_BASE_URL`) |

---

## Onboarding a New Client

```bash
curl -X POST https://YOUR_URL/clients \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Cool Breeze HVAC",
    "phone_number": "+15559876543",
    "industry_vertical": "hvac",
    "crm_platform": "stub",
    "timezone": "America/Chicago",
    "services": [
      { "service_name": "AC Tune-Up", "base_price": 89.00, "duration_minutes": 60 },
      { "service_name": "Furnace Repair", "base_price": 149.00, "duration_minutes": 90 }
    ],
    "call_config": {
      "business_hours": {
        "monday": { "open": "08:00", "close": "17:00" },
        "tuesday": { "open": "08:00", "close": "17:00" },
        "wednesday": { "open": "08:00", "close": "17:00" },
        "thursday": { "open": "08:00", "close": "17:00" },
        "friday": { "open": "08:00", "close": "17:00" }
      },
      "after_hours_behavior": "emergency_transfer",
      "transfer_number": "+15550000001",
      "emergency_keywords": ["no heat", "no ac", "gas leak", "carbon monoxide"],
      "tone_override": "professional and friendly"
    }
  }'
```

In Vapi, assign the phone number `+15559876543` to your assistant with the custom LLM — the backend routes automatically.

---

## Adding a New Industry Vertical

1. Create `src/templates/{vertical}.txt` using `{{variable}}` placeholders
2. Available variables: `company_name`, `tone`, `services_list`, `emergency_keywords`, `faq_content`, `after_hours_behavior`, `transfer_number`
3. Add the vertical to the `CHECK` constraint in `schema.sql`

---

## Adding a New CRM Adapter

1. Create `src/crm/yourCRM.js` — implement `getAvailability()`, `createJob()`, `lookupCustomer()`
2. Register it in `src/crm/index.js` `getAdapter()` switch
3. Set `crm_platform: 'yourcrm'` when creating a client

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/vapi/chat` | Vapi custom LLM endpoint (SSE streaming) |
| `POST` | `/vapi/webhook` | Vapi post-call webhook |
| `POST` | `/clients` | Onboard a new client |
| `GET` | `/clients/:id/config` | Get assembled prompt + raw config |
| `GET` | `/clients/:id/calls` | Get call history (`?limit=50&offset=0`) |

---

## Demo Clients (from seed.sql)

| Company | Phone | Vertical |
|---|---|---|
| Arctic Air HVAC | +15551234567 | hvac |
| FlowMaster Plumbing | +15552345678 | plumbing |
| Serenity Day Spa | +15553456789 | spa |
