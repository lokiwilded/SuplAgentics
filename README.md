# SuplAgentics

A multi-agent tooling layer for [opencode](https://opencode.ai) — built on top of the
[OpenChamber](https://github.com/sst/opencode) dashboard fork. SuplAgentics adds:

- **Agent orchestration** — a commander/planner/coder/reviewer hierarchy with 22 specialized subagents
- **History import** — pull Claude Code and opencode session history into searchable memory
- **Improvement mining** — automatic suggestion generation from your coding sessions
- **Session-based plans** — a Plans panel with an annotator/wireframe review flow (works on mobile)
- **RAG semantic search** — local bge-m3 embeddings over your codebase via Ollama
- **Caching tools** — `bash_cached` and `read_cached` for fast repeated agent operations
- **A self-hosted dashboard** — reach it from your desktop, browser, or phone (via Tailscale/LAN)

## Quick Start

### Prerequisites

| Requirement | Why | Install |
|---|---|---|
| **Node.js 20+** | Runs the dashboard + MCP server | [nodejs.org](https://nodejs.org) |
| **Bun** | Package manager + build tool for the UI | [bun.sh](https://bun.sh) (`curl -fsSL https://bun.sh \| bash`) |
| **opencode** | The AI coding agent this system orchestrates | [opencode.ai](https://opencode.ai) (`npm i -g opencode`) |
| **Ollama Cloud API key** | The LLM provider for all agents | [ollama.com](https://ollama.com) — set as `OLLAMA_API_KEY` env var |

### Install & Run

```bash
# 1. Clone
git clone https://github.com/lokiwilded/SuplAgentics.git
cd SuplAgentics

# 2. Install UI dependencies + build the dashboard
cd UI
bun install
bun run build          # produces dist/ — this is what gets served
cd ..

# 3. Install MCP server dependencies
cd MCP
bun install
cd ..

# 4. Set your Ollama Cloud API key
export OLLAMA_API_KEY="your-key-here"    # Linux/Mac
set OLLAMA_API_KEY=your-key-here         # Windows CMD
$env:OLLAMA_API_KEY="your-key-here"      # Windows PowerShell

# 5. Start the dashboard
node start.mjs                          # → http://localhost:3910

# 6. First-run setup (one time only)
#    Open http://localhost:3910 in your browser
#    Go to Settings → click "Run SuplAgentics Setup"
#    This installs the agents/plugins/config into ~/.config/opencode/
#    and registers the MCP server with opencode

# 7. Phone access (same Tailscale/LAN)
node UI/packages/web/bin/cli.js connect-url
```

After setup, just `node start.mjs` to start the dashboard. opencode launches the MCP server
automatically when it starts — you don't start it manually.

## File Structure

```
SuplAgentics/
├── OC/                          # opencode config (agents, plugins, skills)
│   ├── agents/                  #   3 top-level: commander, planner, teacher
│   ├── subagents/               #   22 specialized: coder, reviewer, researcher, etc.
│   ├── plugins/                 #   TypeScript plugins (RAG, cache, compact, background agents)
│   ├── skills/                  #   Reusable skill definitions
│   ├── opencode.json            #   Base config (provider, models, plugins)
│   └── suplagentics-settings.json  # Tuning knobs (cache caps, RAG limits)
│
├── MCP/                         # the MCP server (the engine)
│   ├── src/
│   │   ├── index.js             #   MCP stdio server entry point
│   │   ├── agent-session-runner.js  #  Delegates tasks to subagents
│   │   ├── capabilities/        #   Engine: import pipeline, improvement mining
│   │   └── tools/               #   Tools exposed to opencode (RAG, cache, guard, validate)
│   └── test/                    #   Unit tests (7 passing)
│
├── UI/                          # the dashboard (OpenChamber fork + SuplAgentics customizations)
│   ├── packages/
│   │   ├── web/                 #   Express server + API routes
│   │   │   └── server/lib/suplagentics/  # ← all custom server routes live here
│   │   ├── ui/                  #   React app (the dashboard UI)
│   │   │   └── src/components/suplagentics/  # ← all custom React components live here
│   │   ├── electron/            #   Electron desktop wrapper
│   │   └── mobile/              #   Mobile PWA build
│   ├── docs/                    #   OpenChamber documentation
│   └── scripts/                 #   Build/dev/utility scripts
│
├── PI-Builder/                  # second-layer Pi agent that improves SuplAgentics itself
│   ├── .pi/                     #   Agent configs, extensions, MCP config
│   └── AGENTS.md                #   PI-Builder instructions
│
├── plans/                       # Architecture plans, audit logs, backlog
├── CLAUDE.md                    # Rules for AI agents working on this repo
├── VERSIONS.md                  # Cross-package compatibility matrix
├── start.mjs                    # One-command launcher
├── sync-self.mjs                # Repo ↔ live config sync tool
└── README.md                    # You are here
```

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                    opencode                          │
│  (launches MCP server, loads agents from ~/.config)  │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
           ▼                          ▼
┌───────────────────┐     ┌──────────────────────────┐
│   MCP Server       │     │    Dashboard (UI/)        │
│   (MCP/src/)       │     │                           │
│                    │     │  Express server           │
│  • RAG search      │◄────│  (packages/web/)          │
│  • Cache tools     │     │                           │
│  • Import pipeline │     │  React app                │
│  • Improvement     │     │  (packages/ui/)           │
│    mining          │     │                           │
│  • Agent delegation│     │  Custom routes:           │
└───────────────────┘     │  /api/suplagentics/*       │
                          └──────────────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────────┐
                          │  Browser / Desktop / Phone│
                          │  http://localhost:3910    │
                          └──────────────────────────┘
```

1. **opencode** launches the MCP server (registered in `~/.config/opencode/opencode.json`)
2. The **MCP server** provides tools: semantic code search, cached bash/file reads, history
   import, improvement mining, and agent session delegation
3. The **dashboard** (UI/) is a web app you open in a browser — it talks to both opencode
   (for session management) and the MCP server (for the engine)
4. **Agents** are markdown files in `OC/agents/` and `OC/subagents/` — the first-run setup
   copies them into `~/.config/opencode/` where opencode reads them

## The Agent Roster

| Agent | Role | Permissions |
|---|---|---|
| **commander** | Orchestrator — delegates to subagents, never codes | Deny all (delegates only) |
| **planner** | Plans before building — writes PLAN.md files | Read + bash (read-only) |
| **teacher** | Explains code and concepts | Read + bash (read-only) |
| **coder** | Writes code | Read + write + bash |
| **quick** | Fast one-shot fixes | Read + write + bash |
| **reviewer** | Reviews code for correctness | Read + bash (read-only) |
| **researcher** | Explores codebase, answers questions | Read + bash (read-only) |
| **js-verifier** | Verifies JS/TS builds pass | Read + bash |
| **python-verifier** | Verifies Python runs | Read + bash |
| **vision** | Describes images/sketches for the planner | Read |
| **guardian** | Safety checks on agent output | Read |
| + 11 more | Import, insights, memory, docs, diagrams, etc. | Various |

## Configuration

### Ollama Cloud Models

The system uses Ollama Cloud with these models (configured in `OC/opencode.json`):

| Model | Context | Use |
|---|---|---|
| `glm-5.2` | 976K | Primary model (commander, coder, etc.) |
| `deepseek-v4-flash` | 1M | Small/fast model (quick tasks, STM) |
| `deepseek-v4-pro` | 1M | Heavy reasoning |
| `devstral-small-2:24b` | 256K | Code generation |
| `minimax-m2.7` | 192K | General purpose |
| `gemma4:31b` | 256K | General purpose |
| `gpt-oss:20b` | 128K | General purpose |

### Settings

Tuning knobs live in `OC/suplagentics-settings.json` (copied to
`~/.config/opencode/suplagentics-settings.json` on setup):

```json
{
  "cache_read_cap_chars": 15000,
  "cache_bash_cap_chars": 8000,
  "rag_top_k": 5,
  "rag_reindex_stale_threshold": 300
}
```

## Development

### The #1 gotcha: bun serves a cached copy

bun copies `file:` dependencies into `node_modules/.bun/`. After editing anything in `OC/` or
`MCP/`, you must refresh the cache or changes won't reach the running system:

```bash
cd UI
rm -rf node_modules/.bun/suplagentics-opencode@file+..+OC \
       node_modules/.bun/suplagentics-mcp-server@file+..+MCP \
       packages/web/node_modules/suplagentics-opencode \
       packages/web/node_modules/suplagentics-mcp-server
bun install
bun run build          # needed for UI/React changes
```

Or use the built-in sync tool:

```bash
node sync-self.mjs push          # repo → live (~/.config/opencode/)
node sync-self.mjs dash          # refresh dashboard's bun cache
node sync-self.mjs push --dry    # preview what would change
```

### Commands

```bash
# Run the dashboard
node start.mjs [port]              # default 3910

# Get phone/LAN URL
node UI/packages/web/bin/cli.js connect-url

# Sync repo → live config
node sync-self.mjs push            # copies OC/ agents/plugins/config to ~/.config/opencode/
node sync-self.mjs dash            # refreshes dashboard's cached copy of OC/MCP
node sync-self.mjs pull            # live → repo (capture manual drift)

# MCP tests
cd MCP && npm test                 # 7 unit tests
cd MCP && npm run validate         # validate agent frontmatter

# UI development (hot reload)
cd UI && bun run dev               # dev server with HMR
cd UI && bun run build             # production build
```

### Where custom code lives

All SuplAgentics-specific code is in two places inside `UI/`:

- **Server routes:** `UI/packages/web/server/lib/suplagentics/`
  - `plan-routes.js` — plan feedback, build, annotation persistence
  - `improvement-routes.js` — improvement suggestions API
  - `import-routes.js` — session history import
  - `indexing-routes.js` — RAG workspace management
  - `setup-routes.js` — first-run installer
  - `installer.js` — copies OC/ into `~/.config/opencode/`
  - `api-security.js` — same-origin enforcement + rate limiting
  - `vision-describe.js` — sketch annotation description via vision model

- **React components:** `UI/packages/ui/src/components/suplagentics/`
  - `plan-annotator/` — 19 components for the plan review/annotation UI
  - `sections/` — Settings tabs (Import, Improvement, Indexing)

Everything else in `UI/` is the upstream OpenChamber fork.

## PI-Builder (the second layer)

PI-Builder is a separate Pi agent that lives inside the tree for convenience but runs
independently. It works *on* SuplAgentics from the outside — fixing bugs, working the
backlog, and improving the system using the same agent tooling patterns.

See `PI-Builder/AGENTS.md` for details.

## Architecture Plans & Audit

- `plans/self-audit.md` — the running problem log + fix ledger
- `plans/next-level-initiative.md` — completed initiative tracker
- `plans/piece-6-backlog.md` — the current work queue
- `VERSIONS.md` — cross-package compatibility matrix
- `CLAUDE.md` — rules for AI agents working on this repo

## License

The UI/ directory is a fork of [OpenChamber](https://github.com/sst/opencode) (AGPL-3.0).
SuplAgentics-specific code (OC/, MCP/, custom routes, custom components) is provided as-is.