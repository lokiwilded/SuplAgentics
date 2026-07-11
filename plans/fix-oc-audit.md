---
title: "OC — plugin-twin divergence + minor cleanup"
status: done
scope: OC
created_at: 2026-07-10
type: plan
source: 2026-07-10 deep audit
---

# Plan: OC — config hygiene

`OC/` is config only (agents, subagents, plugins, `opencode.json`). The audit found it structurally
sound — agents validate, the big plugin has no dangerous primitives — with one architecture hazard and
two minor items.

## Repo context
- Config, no code. Installed into `~/.config/opencode/` by the dashboard's first-run setup.
- `OC/opencode.json` (repo) has diverged from the live `~/.config/opencode/opencode.json` — the live
  file is authoritative (has the MCP block; repo doesn't). Do not blindly overwrite either direction.
- Validate with `node MCP/src/tools/validate-agents.js OC/`.

---

## Fix 1 — [P2] Plugin twins have diverged from the MCP tools
**Location:** `OC/plugins/suplagentics-rag.ts`, `suplagentics-cache.ts`, `suplagentics-compact.ts` vs
`MCP/src/tools/rag-tools.js` + `cache-tools.js`.
**Problem:** the RAG/cache capability exists in two places that have drifted. The plugin twins predate
the MCP ports' staleness/denylist code; the live `opencode.json` doesn't even load the twins (only
`suplagentics-compact.ts` and `kdco-background-agents.ts` are in the live plugin array). So there are
unused, divergent copies of core logic — a maintenance trap (A-4).
**Fix (decide canonical home):**
1. Confirm the MCP server is the single source of truth for RAG/cache (it is — agents' `permission:`
   blocks reference `suplagentics_search_code` etc., the MCP tool names).
2. Either delete `suplagentics-rag.ts` + `suplagentics-cache.ts`, or add a header comment marking them
   unused/legacy and remove them from `OC/opencode.json`'s plugin array so the two never re-diverge.
3. Keep `suplagentics-compact.ts` (it IS loaded live and does something the MCP server doesn't).
**Verification:**
- [ ] `grep suplagentics-rag ~/.config/opencode/opencode.json` → absent (already true live).
- [ ] Removing the twins doesn't break a fresh install (RAG comes from the MCP server).

## Fix 2 — [P3] `planner.md` has no `model` field
**Location:** `OC/agents/planner.md` (validator warning).
**Problem:** `validate-agents.js` warns it will fall back to the system default model.
**Fix:** add an explicit `model:` line (match the other planning agents, e.g.
`ollama-cloud/deepseek-v4-flash`) or confirm the default is intended and suppress the warning.

## Fix 3 — [P2] `kdco-background-agents.ts` — risk-scanned 2026-07-10, CLEARED
**Location:** `OC/plugins/kdco-background-agents.ts` (1983 lines).
**Result:** all risk indicators clean — 0 `execSync`/`eval`/`fetch`/secret access, 0 empty `catch {}`
(no silent error-swallowing), 0 `while(true)`/`for(;;)` (no unbounded loops), 0 direct session-spawn
calls (uses the opencode plugin API). A full line-by-line logic read isn't warranted given clean
indicators. Re-scan if it grows or gains any of those primitives.

---

## Done when
- [ ] Plugin twins deleted or clearly marked unused + removed from the plugin array.
- [ ] `validate-agents.js OC/` runs with zero warnings (or the planner warning is a deliberate, documented default).
- [ ] A follow-up exists for the `kdco-background-agents.ts` logic read.

## Escape hatch
If the plugin twins are still wired into some path you're unsure about, don't delete — just add the
"unused/legacy, canonical logic is in MCP/src/tools" header and revisit. Reversible either way
(`git -C OC checkout .`).
