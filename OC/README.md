# suplagentics-opencode — the opencode scaffolding

Config only, no code. This is everything SuplAgentics installs into `~/.config/opencode/`, organized
so you can see and edit it in one place.

```
OC/
├── agents/                     3 top-level agents you invoke directly (commander, planner, teacher)
├── subagents/                  22 mode:subagent workers (insights-*, *-verifier, claude-import-summarizer, …)
├── skills/                     opencode skills (devbyloki-sites, opencode-skill-creator)
├── plugins/                    opencode plugins (.ts): suplagentics-cache/compact/rag, kdco-background-agents
├── opencode.json               base config the installer merges
├── suplagentics-settings.json  default SuplAgentics settings
└── package.json                makes this resolvable as `suplagentics-opencode` (the installer finds it this way)
```

## How it installs

opencode reads config from **`~/.config/opencode/`**, not from here. On first-run setup, the
dashboard's `installer.js` (in `../UI/packages/web`) copies this out:

| Here | Installs to | Notes |
|---|---|---|
| `agents/` + `subagents/` | `~/.config/opencode/agents/` | flattened into one dir (opencode has no subagents folder — it's the `mode:` frontmatter) |
| `plugins/` | `~/.config/opencode/plugin/` | always overwritten (ships bug fixes) |
| `opencode.json` | merged into `~/.config/opencode/opencode.json` | additive |
| `suplagentics-settings.json` | `~/.config/opencode/suplagentics-settings.json` | |
| `skills/` | *(not auto-installed)* | mirrored for visibility; skills are self-managed |

**Editing rule:** change something here → refresh the dashboard's cached copy (see the root
`CLAUDE.md` "THE gotcha") → re-run setup.

## Not here: tools and the engine

The **tools** and the **engine** are server code and live in `../MCP/src/` (`tools/` +
`capabilities/`). This folder is purely the config opencode consumes.
