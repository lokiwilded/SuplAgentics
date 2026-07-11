# SuplAgentics — structure map

The system is **three folders** under `D:\SuplAgentics` (see the root `README.md` for the overview):

```
D:\SuplAgentics\
├── OC\    the opencode scaffolding — agents, subagents, skills, plugins, config  (config only)
├── MCP\   the server — engine (capabilities) + tools opencode calls              (code only)
└── UI\    the dashboard — this repo (React app + Express server + your custom UI)
```

## The mental model

```
   OC (config) ──installed by UI's first-run setup──▶ ~/.config/opencode
   MCP (engine + tools) ──imported by──▶ UI/packages/web ──serves──▶ UI/packages/ui (React screens)
                                                                          ▲
                     the same UI is wrapped by:  packages/web (browser) · electron (desktop) · mobile (phone)
```

- **OC** is what you tune (agents/plugins/skills). **MCP** is where the work happens. **UI** is the
  screens plus the server that ties everything together — `web`/`electron`/`mobile` are three windows
  onto the **same** UI.

---

## `MCP\` — `suplagentics-mcp-server` (server code only)

Imported by the dashboard (`UI/packages/web` → `file:../../../MCP`) and launched by opencode.

```
MCP/src/
├── index.js                MCP stdio server entry
├── agent-session-runner.js session-based subagent delegation (NOT `opencode run`)
├── suplagentics-home.js    resolves the SuplAgentics home dir
├── sqlite-runtime.js       better-sqlite3 loader
├── capabilities/           THE ENGINE — import pipeline, improvement mining
├── tools/                  MCP tools (import/rag/cache) — expose the engine to opencode
└── cli/                    push-memory helper
```

## `OC\` — `suplagentics-opencode` (config only)

`agents/` (3) · `subagents/` (22) · `skills/` (2) · `plugins/` (4) · `opencode.json` · settings —
see `OC/README.md`. The installer (`UI/packages/web`) resolves this package and flattens
`agents/` + `subagents/` into `~/.config/opencode/agents/`.

## `UI\` — the dashboard (an OpenChamber monorepo fork)

Four workspace packages under `UI/packages/`:

| Package | Name | What it is | Status |
|---|---|---|---|
| **`ui`**  | `@openchamber/ui` | The React frontend — **every screen, all SuplAgentics UI** | core |
| **`web`** | `suplagentics` | Express server + CLI (`bin/cli.js serve`) — **all SuplAgentics server routes** | core |
| `electron` | `@openchamber/electron` | Desktop-app wrapper (bundles `web`) | optional shell |
| `mobile` | `@openchamber/mobile` | Capacitor iOS/Android shell | optional shell |

> Run the dashboard: `cd UI/packages/web && node bin/cli.js serve --port 3910`
> Rebuild UI after editing `packages/ui`: `bun run build` (from `UI/packages/web`)

### Where SuplAgentics features live (the parts grafted into the fork)

| Feature | Server — `UI/packages/web/server/lib/suplagentics/` | UI — `UI/packages/ui/src/` |
|---|---|---|
| Indexing settings | `indexing-routes.js` | `components/sections/suplagentics/IndexingSettings.tsx` |
| Import History | `import-routes.js` | `components/sections/suplagentics/ImportSettings.tsx` |
| Improvements | `improvement-routes.js` | `components/sections/suplagentics/ImprovementSettings.tsx` |
| Plans + annotator (incl. wireframe designer) | `plan-routes.js` | `components/suplagentics/plan-annotator/` |
| First-run installer + MCP registration | `setup-routes.js`, `installer.js` | `components/sections/suplagentics/SuplagenticsSetupBanner.tsx` |

Agent templates (the shipped roster) now live in **`MCP/opencode/agents/`** — see
`MCP/opencode/README.md`.

### Where the actual UI is (`packages/ui/src/`)

The React app. Your SuplAgentics UI is **two isolated folders** bolted onto the fork — everything
else here is untouched openchamber.

```
packages/ui/src/
├── components/
│   ├── views/                THE PAGES — ChatView, SettingsView, FilesView, PlanView, TerminalView…
│   ├── sections/
│   │   └── suplagentics/     ← YOUR settings pages (Import, Improvement, Indexing, SetupBanner)
│   └── suplagentics/
│       └── plan-annotator/   ← YOUR plan annotator + WireframeDesigner (18 files)
├── apps/                     app shells (MobileApp, …)
├── lib/                      utilities — i18n messages, settings metadata
├── stores/ contexts/ hooks/  state management
└── App.tsx / main.tsx        entry point
```

You customize the fork two ways: (1) the two `suplagentics/` folders above, and (2) a few
registration lines in shared files — settings nav in `lib/settings/metadata.ts` +
`components/views/SettingsView.tsx`, strings in `lib/i18n/messages/*`, mobile page list in
`apps/MobileApp.tsx`. ~22 of your files among ~2000 fork files — a clean graft, not a rewrite.

### Docs (all SuplAgentics docs under one folder)

```
UI/docs/
├── CUSTOM_THEMES.md  REVERSE_PROXY.md  references/   ← openchamber's own (untouched)
└── suplagentics/                                     ← everything of ours
    ├── README.md  brainstorm.md  ideas.md
    └── plugin-catalog/   (15)   opencode plugin ecosystem reference
```

---

## Live runtime state — NOT in this repo

These stay under your home dir (shared by opencode globally; deliberately left in place):

- `~/.config/opencode/` — `opencode.json` (MCP registration), **live** `agents/*.md`, `improvements/`
- `~/.local/share/opencode/` — `opencode.db`, ephemeral import queue, auth
- `~/.opencode-mem/data/` — the real memory shards (written via the local API on :4747)

> Note: the live `~/.config/opencode/agents/` has 3 agents not shipped as templates here:
> `astro-verifier`, `liquid-verifier`, `python-verifier`.

## Removed in the 2026-07 cleanup

`packages/vscode` (VS Code extension) and `packages/docs` (upstream doc site) were deleted — unused,
and contained no SuplAgentics code. A few dead "vscode" menu entries remain in `scripts/oc-dev.mjs`
(an optional dev CLI); harmless unless invoked.
