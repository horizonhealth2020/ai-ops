3 files written to `.claude/skills/vapi/`:

**SKILL.md** — Quick reference covering the SSE proxy pattern, pre-compiled prompt usage, wallet-gated tool access, and post-call cleanup. Links to both reference files.

**references/patterns.md** — Covers:
- SSE header requirements (missing headers = Vapi buffers instead of streams)
- Auth middleware supporting both Bearer and `X-Vapi-Secret`
- Multi-tenant client resolution (metadata first, phone fallback)
- OpenAI function-calling tool definition format
- Wallet-gated tool filtering
- Two WARNINGs: compiling prompts inside the request handler, and awaiting n8n webhooks in the response path

**references/workflows.md** — Covers:
- Full inbound call lifecycle with step-by-step sequence
- Compile vs Build distinction (when each runs, cost difference)
- 3-phase booking flow with Redis SETNX atomicity notes
- Checklist for adding a new Vapi tool (9 steps)
- Checklist for onboarding a new client end-to-end (9 steps + validation curl)