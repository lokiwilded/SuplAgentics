# SuplAgentics

**Multi-agent AI coding tooling for [opencode](https://opencode.ai)** — history import into
memory, improvement-suggestion mining, plan review with annotations, and a specialized agent
roster, delivered through a forked [OpenChamber](https://github.com/btriapitsyn/openchamber)
dashboard and a standalone MCP server.

Works with **Ollama Cloud** (subscription, no GPU needed) and **local Ollama** (free) — the
Indexing settings page lets you point the pipeline at whichever model you want.

---

## Repo layout

This root repo holds documentation and per-project feature data. The running code lives in two
nested repos, each with its own git history:

| Directory | What it is |
|---|---|
| `openchamber/` | Fork of OpenChamber (MIT) — the dashboard. SuplAgentics features live in `packages/web/server/lib/suplagentics/` and `packages/ui/src/components/**/suplagentics/`. |
| `mcp-server/` | `suplagentics-mcp-server` — standalone MCP stdio server holding the actual capability logic (import pipeline, improvement mining, session delegation). Usable from any MCP client, not just the dashboard. |
| `plans/` | Architecture and decision history (start with `plans/openchamber-fork-port.md`). |
| `improvements/`, `progress-log/` | This repo's own suggestion/build artifacts (git-tracked, same convention as any tracked project). |
| `docs/` | Installed-plugin catalogs and historical screenshots. |

The pre-fork stack (twin Node/Bun servers + React SPA) was removed 2026-07-06; it's recoverable
from git history at the "Snapshot before old-stack cleanup" commit.

## Run it

```bash
cd openchamber/packages/web
bun install        # once, from openchamber/ root
bun run build      # build the UI bundle
node bin/cli.js serve --port 3910
```

Open http://localhost:3910. On first run the setup banner installs the agent roster, plugins, and
registers the MCP server with opencode.

## What it does

- **Indexing** (Settings → Indexing) — status and control for the pipeline that turns imported
  session history into searchable memories; pick local or cloud models for the summarizer and the
  insights agents; stalled queues are detected and surfaced with a Retry instead of looping.
- **Import History** (Settings → Import History) — one-click import of opencode and Claude Code
  session history into [opencode-mem](https://github.com/opencode-ai/opencode-mem), tied to the
  real projects it came from, with secret redaction before anything is summarized.
- **Improvements** (Settings → Improvements) — Skills / Agents / Workflows suggestions mined from
  your memory, per-project and global (cross-project synthesis). Review with inline annotations,
  approve into a plan, and build it in a live commander chat session.
- **Plans** — session-based planning with the plan-annotator review flow (approve/deny with
  CriticMarkup feedback sent back to the live planning session).
- **Agent roster** — commander routes work to specialists (researcher, coder, reviewer, guardian,
  and more), with batch agents (`claude-import-summarizer`, `insights-*`) running headlessly via
  session delegation.
- **MCP tools** — `suplagentics_import_scan`, `suplagentics_import_status`,
  `suplagentics_improvement_suggestions` — the same capabilities, callable from any MCP client
  (opencode, Claude Code, Claude Desktop).

## Prerequisites

| Requirement | How to get it |
|-------------|--------------|
| **Node.js 18+** and **Bun** | [nodejs.org](https://nodejs.org), [bun.sh](https://bun.sh) |
| **opencode** | `npm install -g opencode-ai` |
| **Ollama** + `bge-m3` | [ollama.com](https://ollama.com), `ollama pull bge-m3` (memory embeddings) |
| **opencode-mem** | Memory store the import/improvement features write to (web UI at :4747) |

## Developing

- UI changes: edit `openchamber/packages/ui/`, then `bun run build` in `openchamber/packages/web`
  and restart the server.
- Capability changes: edit `mcp-server/src/`, then **run `bun install` in `openchamber/`** — bun
  copies the `file:` dependency, it does not symlink it.
- Checks: `bun run type-check:ui`, `bun run type-check:web`, `bun run lint:ui` from
  `openchamber/`.

See `CLAUDE.md` for the full architecture notes and gotchas.
