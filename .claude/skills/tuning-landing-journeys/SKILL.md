7 files created in `.claude/skills/tuning-landing-journeys/`:

**SKILL.md** — Quick reference covering the onboard-to-live-call funnel, key friction points (zero-balance wallet, missing activation signals in dashboard config), and patterns for adding readiness fields to API responses.

**references/**:
- **conversion-optimization.md** — The 4-gate activation funnel, the `$0 wallet problem`, adding `activation_checklist` to onboard response, and a full audit checklist
- **content-copy.md** — Where copy lives (prompt compiler, API errors), vertical-specific identity strings for `assemblePrompt()`, and the wallet empty-state copy gap
- **distribution.md** — Onboard webhook as acquisition entry point, missing post-onboard n8n activation sequence, Twilio SMS as distribution channel
- **measurement-testing.md** — SQL queries for booking conversion rate, wallet activation latency, and the missing structured event logging problem at onboard
- **growth-engineering.md** — Two latent growth loops, returning caller recognition as a retention metric, closing the auto-reload dead code path, and adding `referral_source`
- **strategy-monetization.md** — Tier upgrade endpoint (missing), message-only mode as paywall, usage-based tier upgrade triggers, two-level low-balance warnings