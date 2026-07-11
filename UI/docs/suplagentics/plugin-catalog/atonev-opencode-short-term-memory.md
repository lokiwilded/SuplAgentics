# @atonev/opencode-short-term-memory

**Type:** npm OpenCode plugin  
**Package:** `@atonev/opencode-short-term-memory`  
**Installed at:** `~/.config/opencode/node_modules/@atonev/opencode-short-term-memory/`

## What it does

Automatically summarizes conversation context into structured session memory and re-injects it into the system prompt every few turns — separate from `opencode-mem`'s longer-term project memory (this one is scoped to the current session, not persisted across sessions).

## Tools exposed

| Tool | Signature | Description |
|------|-----------|--------------|
| `short_term_memory` | `(action)` | Inspect or control the plugin. `action`: `show`, `status`, `logs`, `update`, `reset`, `settings`. |

## Notes

- Same interface as the `/stm` slash command it also registers — callable as a tool instead
- Complements, not replaces, `opencode-mem` — this is short-lived per-session context, opencode-mem is the durable cross-session store
