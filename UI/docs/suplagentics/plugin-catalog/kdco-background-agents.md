# kdco-background-agents

**Type:** Local OpenCode plugin  
**Location:** `~/.config/opencode/plugin/kdco-background-agents.ts`  
**Upstream:** vendored from [code-yeongyu/oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)

## What it does

Async, read-only delegation with persisted, retrievable output — superficially similar naming to OpenCode's built-in `task` tool, but not a true built-in. Also guards native `task` itself: if you target a read-only sub-agent through `task`, the call is blocked and you're redirected to `delegate` instead.

## Tools exposed

| Tool | Signature | Description |
|------|-----------|--------------|
| `delegate` | `(prompt, agent)` | Delegate to a read-only sub-agent. Returns immediately with an ID. A notification arrives on completion; use `delegation_read` to retrieve full output (works even after context compaction). `agent` must be a read-only sub-agent (edit/write/bash all denied) or the call is blocked. |
| `delegation_read` | `(id)` | Read a delegation's output by ID — works even if the inline completion notification was lost to compaction. |
| `delegation_list` | `()` | List all delegations for the current session, running and completed — use if an ID was lost before re-delegating. |

## Notes

- Fire multiple `delegate` calls in parallel — they run simultaneously
- For blocking, full-write-access subagent work, use the built-in `task` tool instead — this plugin's tools are specifically for async, read-only work
