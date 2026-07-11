# cc-safety-net

**Type:** npm OpenCode plugin  
**Package:** `cc-safety-net`  
**Installed at:** `~/.config/opencode/node_modules/cc-safety-net/`

## What it does

A `tool.execute.before` hook that blocks destructive bash commands before they run — confirmed via its real compiled source (`dist/index.js`), not just its description. Covers `rm -rf` outside the current working directory, `rm -rf` with shell-variable targets that can't be statically verified, `rm -rf` targeting root/home directories (always blocked), `find -exec rm -rf`, parallel/xargs `rm -rf` with dynamic input, and dangerous commands embedded in interpreter code (e.g. `python -c "..."`).

## Tools exposed

None — this is a pure guard hook, registers no agent-callable tools.

## Notes

- Runs transparently before any `bash` call; a blocked command returns a reason string explaining why (e.g. "rm -rf outside cwd is blocked. Use explicit paths within the current directory, or delete manually.")
- No config file — the blocked-pattern set is built into the plugin
