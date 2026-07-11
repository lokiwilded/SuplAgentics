# SuplAgentics Version Compatibility Matrix

This file tracks which versions of the three coupled packages (OC/MCP/UI) are known to work
together. They form a tightly-coupled system — changes in one may break another. **PI-Builder** is
the separate second-layer tool (its own repo) and is intentionally not part of this matrix.

## How to use this

After any change to OC, MCP, or UI that affects cross-package APIs:
1. Update the version in the changed package's `package.json`
2. Add a row to this matrix
3. Update the dependency ranges in the other packages if needed

## Compatibility Matrix

| Date       | OC     | MCP    | UI (fork) | Notes                                      |
|------------|--------|--------|-----------|---------------------------------------------|
| 2026-07-09 | 1.0.0  | 1.0.1  | (fork)    | Initial audit baseline                      |
| 2026-07-09 | 1.0.0  | 1.0.2  | (fork)    | Post-audit: blobToVec fix, cosine guard, health check, command denylist, async scan, etc. |
| 2026-07-10 | 1.0.0  | 1.0.2  | (fork)    | Re-audit: several 1.0.2 "fixes" were false. Actually fixed + tested: search_code (was throwing every call), bash_cached denylist (was inert), index.js health/shutdown, embed-failure reporting, plan-routes LIKE. See plans/fix-*-audit.md. |

## Breaking Change Checklist

When changing these interfaces, update ALL three packages:

### MCP -> UI (dashboard imports from MCP)
- `scanClaudeProjects`, `opencodeScan`, `findAllSessionFiles` (now async)
- `importProject`, `runImportBatch`, `importOpencodeSessions`
- All claude-import-db.js exports
- `spawnSummarizerBatch`, `processMemoryPushQueue`
- `parseFrontmatter`, `mergeSuggestions`, etc.
- `runSubagentDelegation`, `startCommanderSession`
- `serializeAnnotations`
- All MCP tool registrations (input schemas)

### OC -> UI (installer reads from OC)
- `opencode.json` provider/model/plugins structure
- `suplagentics-settings.json` keys
- Agent/subagent filenames (must match `SUPLAGENTICS_AGENT_NAMES`)
- Plugin filenames (must match `REQUIRED_PLUGIN_ENTRIES`)

### MCP -> MCP (internal)
- `openDb` API shape
- `SUPLAGENTICS_HOME`, `ensureSuplagenticsHome`
