Three files created at `~/.claude/skills/redis/`:

**SKILL.md** — Quick reference with the key namespace table, read-through cache pattern, atomic SETNX example, and graceful degradation pattern.

**references/patterns.md** — Deep-dive on:
- ioredis client init (`lazyConnect`, retry strategy)
- Multi-tenant key namespacing rules
- Read-through cache (config, OAuth tokens)
- Atomic `SET key value EX ttl NX` vs two-step SETNX+EXPIRE (WARNING)
- SMEMBERS/SREM for held slots filtering
- Rate limiter INCR pattern
- Anti-patterns: two-step SETNX, silent error swallowing, missing TTLs

**references/workflows.md** — Step-by-step workflows with checklists:
- 3-phase booking (check → hold → release) with concurrent safety
- Call completion cleanup sequence
- Config cache invalidation on dashboard mutations
- Graceful shutdown (`redis.quit()` vs `redis.disconnect()`)
- Health check implementation