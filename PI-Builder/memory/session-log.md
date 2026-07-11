# PI-Builder Memory — Session Log

## 2026-07-09 — Initial Setup

- Scaffolded PI-Builder: the second-layer agent toolkit for working on SuplAgentics from outside
- Created: fixer.js (interactive CLI), audit-scanner.js, diff-live.js, sync.js, refresh.js
- Created: agent profile (agents/pi-fixer.md) with full context about the propagation problem
- Read and understood the full self-audit: P0-1 resolved, P0-2 open (stale RAG), C-1 through C-6 open
- Key understanding: OC/ = config, MCP/ = code, UI/ = dashboard. Each has its own git repo.
- The `sync-self.mjs` tool already exists in SuplAgentics and handles pull/push/dash operations
- PI-Builder wraps that tool rather than reimplementing it

## 2026-07-09 — Rebuilt as a Pi workspace (not OpenCode)

Correction: PI-Fixer runs in **Pi** (`@earendil-works/pi-coding-agent` v0.80.3, ollama-cloud),
NOT OpenCode. PI-Builder is the Pi workspace that outfits Pi to improve SuplAgentics from outside
and replace its Improvements subsystem.

Architecture (gap-analysis converged, no functional gaps):
- Packages: pi-hermes-memory, context-mode, @tintinweb/pi-subagents (scheduling+worktrees),
  bigpowers, pi-soly, + gap-fillers pi-mcp-adapter (reuse SuplAgentics' MCP RAG), pi-lens
  (live verify), cc-safety-net (guard). Model: glm-5.2 (fallback glm-5.1).
- Custom glue built (step 1+2): `AGENTS.md`, `.pi/settings.json`, `.pi/mcp.json`,
  `.pi/extensions/suplagentics.ts` (9 tools), `.pi/prompts/{work,recent}.md`,
  `.pi/skills/improve-suplagentics/`, `.pi/agents/{scout,planner,worker,reviewer}.md`.

Key facts:
- Convos live in `~/.local/share/opencode/opencode.db` (session/message/part tables). part.data
  `type: tool` carries `state.status` → auto-flag tool errors = "clear issues" review feature.
- **C:→D: repoint:** SuplAgentics convos recorded at `C:/Users/lokid/dev/SuplAgentics` (216
  sessions), fixes land at `D:/SuplAgentics`. Extension aliases convo-dir → fix-root.
- Decision: ARCHIVE old sessions to `.pi/corpus/` + filter picker; do NOT delete from live DB.
- Data layer validated standalone: node:sqlite (Node 26 builtin) reads the DB read-only fine.

Next: step 3 = `pi install` the 8 packages + Windows-verify pi-lens/pi-mcp-adapter + confirm
glm-5.2 resolves. step 4 = archive/index. step 5 = smoke-test the loop on finding P0-2 (stale RAG).

## 2026-07-09 — Step 3+4 DONE (installed + validated through Pi)

- glm-5.2 confirmed on ollama-cloud with **1M context** (glm-5.1 only 203K) — pinned glm-5.2.
  deepseek-v4-flash (scout's cheap model) also resolves (1M ctx).
- Installed 7 packages project-local (`pi install -l --approve` → `.pi/npm/`, `.pi/settings.json`).
- **Conflict found & fixed:** pi-mcp-adapter collided with pi-soly (both register `mcp` tool +
  `--mcp-config`). pi-soly BUNDLED pi-mcp-adapter (index.ts:933, same author nicobailon) → dropped
  the redundant pi-mcp-adapter. Final set: pi-hermes-memory, context-mode, @tintinweb/pi-subagents,
  bigpowers, pi-soly (provides MCP via `.pi/mcp.json`), pi-lens, cc-safety-net.
- Smoke test PASSED through Pi (glm-5.2): extension loads, imports resolve, tools execute.
  Validated: supl_projects (24 projects), supl_archive (142 sessions → .pi/corpus/suplagentics.jsonl,
  86 with tool-issue signal), supl_scan (10 open findings), supl_diff (repo↔live already in sync).
- All 7 packages load clean on Windows (a bad load errors loudly, as the conflict did).
- TODO (non-blocking): confirm pi-soly's `/mcp` reads `.pi/mcp.json` and connects to the SuplAgentics
  MCP server in the first real session. step 5 (interactive): run `/work` on P0-2 with the user.
