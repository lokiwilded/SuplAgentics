---
name: improve-suplagentics
description: The loop for improving SuplAgentics from the outside — mine conversations for what to improve, fix it in the repo, and PROVE the fix propagated to the running system. Use whenever working on any SuplAgentics fix, improvement, or self-audit finding.
---

# Improve SuplAgentics — the replacement for its Improvements subsystem

SuplAgentics cannot safely edit itself (edits to `OC/`/`MCP/` don't change what's running until
propagated). You do it from the outside, and you do it better than its old Improvements scans.

## The loop

1. **Signal — what needs improving?**
   - `supl_session` (review a specific session the user picked) or the archived corpus in `.pi/corpus/`.
   - `memory:session_search` for recurring pain across sessions.
   - `supl_scan` for open self-audit findings (P0/P1…).
   - Tool errors flagged by `supl_session`/`supl_archive` are the strongest signal.
2. **Locate** — `suplagentics_search_code` (SuplAgentics' own RAG, via the MCP adapter) and
   `ctx_search` for anything large. Confirm which of `OC/` (config), `MCP/` (code), `UI/` it lives in.
3. **Plan** — use the bigpowers lifecycle; write a `PLAN.md` (pi-soly). Get a human OK (`ask_pro`)
   before building anything non-trivial.
4. **Build** — delegate to the `worker` subagent. Edit the **repo** at `D:/SuplAgentics`, never the
   live `~/.config/opencode`. Each of `OC/`, `MCP/`, `UI/` is its own git repo → reversible with
   `git -C <dir> checkout .`.
5. **Verify** — pi-lens must be clean; run the target's own checks via bash (`cd D:/SuplAgentics/UI
   && bun run build`, `bun run check`; MCP smoke test from CLAUDE.md). Then the `reviewer` subagent.
6. **Propagate (never skip):** `supl_sync push` → `supl_diff` must report **already in sync** →
   `supl_refresh` (adds dashboard rebuild for UI/route changes). A fix that doesn't pass `supl_diff`
   is NOT done — it looks applied and changes nothing. This is the entire reason PI-Builder exists.
7. **Record** — `memory` the outcome + any new gotcha; update `STATE.md`.

## Subagent routing (@tintinweb/pi-subagents)

`scout` (recon, cheap model) → `planner` → `worker` (edits) → `reviewer`. Schedule periodic
improvement scans with an interval/cron subagent if the user wants autonomy.

## Hard rules

- Edit the repo, then `push`. Never edit live config directly.
- A fix isn't done until `supl_diff` shows in-sync.
- Never send secrets (`*secrets*.json`, `auth.json`, `.env`, keys) to the model or into memory/corpus.
- Prefer reusing SuplAgentics' MCP engine over re-implementing capabilities it already has.
