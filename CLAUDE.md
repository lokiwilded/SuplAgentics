# CLAUDE.md

Guidance for working on SuplAgentics in `D:\SuplAgentics`. See `README.md` for the user-facing
overview and `UI/STRUCTURE.md` for the detailed UI map.

## What this is — three coupled packages + a second layer

| Folder | Package | Is | Never put here |
|---|---|---|---|
| **`OC/`** | `suplagentics-opencode` | **config only** — agents, subagents, skills, plugins, `opencode.json`, settings | code (it can't import anything; it's copied verbatim to `~/.config/opencode`) |
| **`MCP/`** | `suplagentics-mcp-server` | **code only** — the MCP stdio server: `src/capabilities/` (engine) + `src/tools/` (exposes it) + `agent-session-runner.js` | config/scaffolding (that's OC's job) |
| **`UI/`** | openchamber fork | the dashboard (React `packages/ui` + Express `packages/web`) + your custom UI/routes | — |
| **`PI-Builder/`** | `pi-builder` | the **second layer** — a Pi agent that improves the other three *from the outside*. Its own gitignored repo (never touched by the running system). | anything OC/MCP/UI need at runtime |

OC/MCP/UI are the coupled system; PI-Builder is a separate tool that works on them. The split is
deliberate and load-bearing:
- **Tools are server code.** `src/tools/*.js` `registerTool()` into the running MCP server and import
  `src/capabilities/`. They live in `MCP/src/`, NOT in `OC/`. Moving them out breaks MCP's
  self-containment.
- **`capabilities/` is the engine, not "skills."** The dashboard imports it in ~11 places
  (`suplagentics-mcp-server/src/capabilities/...`). Renaming it breaks those and collides with the
  real `OC/skills/` concept.

## How the three are wired

`UI/packages/web/package.json` depends on both siblings by path:
```
"suplagentics-mcp-server": "file:../../../MCP",   // engine + runner (imported by route files)
"suplagentics-opencode":   "file:../../../OC",    // scaffolding (resolved by the installer)
```
- `setup-routes.js` finds OC via `import.meta.resolve('suplagentics-opencode/package.json')` → its
  dir. The installer copies OC into `~/.config/opencode/` and registers `MCP/src/index.js` in
  `opencode.json`.
- opencode launches the MCP server itself (`node .../MCP/src/index.js`); you don't start it manually.

## THE gotcha: bun serves a cached copy of OC and MCP

bun copies `file:` deps into `node_modules/.bun/<name>@file+..+<DIR>/…`. Plain `bun install` will
**not** refresh that copy when you only changed files inside OC/ or MCP/. After editing an agent,
plugin, or capability, refresh it:
```bash
cd UI
rm -rf "node_modules/.bun/suplagentics-opencode@file+..+OC" "node_modules/.bun/suplagentics-mcp-server@file+..+MCP" \
       packages/web/node_modules/suplagentics-opencode packages/web/node_modules/suplagentics-mcp-server
bun install
```
Avoid `bun install --force` (rebuilds better-sqlite3 with node-gyp, which fails here; the prebuilt
binary works).

## Commands

```bash
# setup (one-time)
cd UI && bun install && bun run build       # dist/ is what `serve` serves
cd ../MCP && bun install                     # MCP's own deps (better-sqlite3 etc.)

# run the dashboard
node start.mjs [port]                         # default 3910; or: cd UI/packages/web && node bin/cli.js serve
node UI/packages/web/bin/cli.js connect-url   # phone/LAN URL

# smoke-test the MCP server directly
cd MCP && printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node src/index.js
```

## OC/ specifics

- `agents/` (3 top-level) + `subagents/` (22 with `mode: subagent`) are **flattened** into one
  `~/.config/opencode/agents/` by the installer — opencode has no subagents dir; the split is
  source-side readability only. Batch agents (`insights-*`, `claude-import-summarizer`, `*-verifier`)
  MUST be `mode: subagent`.
- Agent frontmatter is the config surface: `model:`, `tools:`, `permission:` (an object, never a
  YAML list — that throws `ConfigInvalidError`). The dashboard's Agents/Indexing pages edit these.
- `plugins/` installs to `~/.config/opencode/plugin/` (singular, always overwritten). `skills/` and
  `tools/`… note: `tools/` is NOT here (it's `MCP/src/tools/`); `skills/` is mirrored for visibility
  and not auto-installed.

## Where features live (UI/)

| Feature | Server `UI/packages/web/server/lib/suplagentics/` | UI `UI/packages/ui/src/` |
|---|---|---|
| Indexing / Import / Improvements | `indexing-routes.js` / `import-routes.js` / `improvement-routes.js` | `components/sections/suplagentics/*.tsx` |
| Plans + annotator + wireframe | `plan-routes.js` | `components/suplagentics/plan-annotator/` |
| First-run installer + MCP registration | `setup-routes.js`, `installer.js` | `components/sections/suplagentics/SuplagenticsSetupBanner.tsx` |

Route files import the engine from `suplagentics-mcp-server/src/...` and stay thin.

## Live runtime state (NOT in this repo)

- `~/.config/opencode/` — `opencode.json` (MCP registration), live `agents/`, `plugin/`, `skills/`
- `~/.local/share/opencode/` — `opencode.db`, the ephemeral import queue
- `~/.opencode-mem/data/` — the real memory shards (written via the local API on :4747)
