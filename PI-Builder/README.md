# PI-Builder

The second-layer agent toolkit for working on SuplAgentics from the outside.
This project can't fix itself — so we built this to do it.

## Quick start

```bash
npm run fixer      # interactive CLI with status, scan, diff, sync
npm run scan       # cross-reference self-audit findings with live code
npm run diff-live  # compare repo vs live config for drift
npm run sync       # pull/push repo-live config (wraps sync-self.mjs)
npm run refresh    # push + dash + build in one shot
```

## Architecture

```
PI-Builder/
├── agents/          # Agent profiles (pi-fixer.md)
├── tools/           # Standalone scripts: audit, sync, diff, refresh
├── scripts/         # CLI entrypoints (fixer.js)
├── memory/          # Session state, audit results, fix history
└── package.json
```

## How it reaches into SuplAgentics

- All tools operate on files under `D:\SuplAgentics` (configurable via `SUPAGENTICS_ROOT`)
- They understand the 3-folder split (OC/ MCP/ UI/) and the propagation gotchas
- The `sync` and `refresh` tools wrap `sync-self.mjs` in the SuplAgentics repo
- The `diff-live` tool compares repo `OC/` vs `~/.config/opencode/` to catch drift

## The propagation problem (P0-1)

Editing `OC/` or `MCP/` files does NOT change what the running system executes.
Three separate stale copies exist:

1. **Live agents/plugins** at `~/.config/opencode/` — installer skips existing files
2. **Dashboard bun cache** at `UI/node_modules/.bun/suplagentics-*`
3. **Dashboard dist/** — React build output, needs `bun run build`

After editing, run `npm run refresh` to push repo→live and rebuild.

## Conventions

- Always edit the REPO copy, then propagate (never edit live directly)
- Run `npm run diff-live` before starting work to see current drift
- Commit fixes in the SuplAgentics git repos (OC/, MCP/, UI/ each have their own)
