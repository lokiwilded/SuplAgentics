# opencode-worktree

**Type:** npm package, listed in `opencode.json`'s `plugin` array  
**Package:** `opencode-worktree` v0.4.1  
**Installed at:** `~/.config/opencode/node_modules/opencode-worktree/`

## ⚠️ Not actually functioning as an OpenCode plugin

Verified directly against its real `package.json` and source: this package has **no `main`/`module`/`exports` field** for OpenCode's plugin loader to import — it only declares a `bin` entry (`opencode-worktree`, a standalone TUI you run manually from a terminal, e.g. `npx opencode-worktree`). Its `src/hooks.ts` implements the tool's own "post-create hook" feature (running a user-configured shell command after creating a new git worktree via its own TUI) — this has nothing to do with OpenCode's plugin hook system (`tool.execute.before`, `chat.message`, etc.).

**Practical effect:** listing `"opencode-worktree"` in `opencode.json`'s `plugin` array does nothing — there's no entry point for OpenCode to load. It doesn't register tools, doesn't hook anything, and isn't broken by being there either; it's just inert dead weight in the config.

## What it actually does (as a standalone CLI)

A TUI for managing git worktrees with OpenCode integration — create/switch/remove worktrees, optionally auto-launching `opencode` in the new worktree directory. Genuinely useful, just not through the plugin mechanism it's currently listed under.

## Recommendation

Either remove it from `opencode.json`'s `plugin` array (it isn't doing anything there) and instead document/alias it as a standalone command if you actually use its TUI, or leave it as harmless clutter — it costs nothing at runtime since OpenCode presumably just fails to find a loadable entry point and moves on. Worth a real fix, not urgent.
