# suplagentics-mcp-server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server exposing
SuplAgentics's real capabilities — Import History today, more over time — to any MCP-capable
client (opencode, Claude Code, Claude Desktop), not just one dashboard.

## What this is

SuplAgentics is a set of tools built on top of [opencode](https://opencode.ai) and
[opencode-mem](https://github.com/anthropics/opencode-mem) for importing existing Claude Code /
opencode session history into a searchable memory store, and surfacing improvement suggestions
mined from that history. This package is the portable capability layer — the same logic used by
the [SuplAgentics dashboard](https://www.npmjs.com/package/suplagentics) (an OpenChamber-based
web UI), but callable directly by any MCP client.

## Install

```bash
npm install -g suplagentics-mcp-server
```

## Register with opencode

Add to `~/.config/opencode/opencode.json` (or your project's own config for project-only scope):

```json
{
  "mcp": {
    "suplagentics": {
      "type": "local",
      "command": ["node", "/path/to/suplagentics-mcp-server/src/index.js"],
      "enabled": true
    }
  }
}
```

A `user`-scope entry (the example above) applies to every project automatically — no per-project
setup needed.

## Tools

- `suplagentics_import_scan` — scans this machine for opencode session history (`opencode.db`)
  and Claude Code session history (`~/.claude/projects/`) not yet imported into opencode-mem.
  Returns real per-project session/memory counts and import status.
- `suplagentics_import_status` — live indexing-pipeline state: chunks summarized vs pending,
  memory files pushed, and whether the indexer is running or stalled.
- `suplagentics_improvement_suggestions` — lists mined improvement suggestions for a category
  (`skills`, `agents`, or `workflows`), project-scoped + global merged when a directory is given.

More tools are on the way as more of the underlying capability gets exposed directly.

## License

MIT
