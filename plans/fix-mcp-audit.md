---
title: "MCP — fix audit findings (2 P0 + 2 P1 + 2 P2)"
status: done
scope: MCP
created_at: 2026-07-10
type: plan
source: 2026-07-10 deep audit
---

# Plan: MCP — repair the engine

`MCP/` holds the runtime tools opencode calls. The 2026-07-10 deep audit confirmed the two most
severe bugs in the whole system live here, plus several ledger items marked RESOLVED that were never
actually applied. Fix P0s first — they are runtime-breaking and security-relevant.

## Repo context
- Stack: Node ESM, `@modelcontextprotocol/sdk`, `better-sqlite3` (via `src/sqlite-runtime.js`), `zod`.
- Registered live as `node D:/SuplAgentics/MCP/src/index.js` in `~/.config/opencode/opencode.json`.
- Tests: `node --test test/rag-tools.test.js` (only covers `cosine`/`blobToVec`, NOT tool handlers — that
  gap is why these shipped). Add handler-level tests as part of this plan.
- ⚠ Propagation: opencode must be restarted to pick up MCP changes (it spawns the server). The
  dashboard also runs a bun-cached copy for its imports — see `sync-self.mjs dash`.

---

## Fix 1 — [P0] `search_code` throws on every call
**Location:** `src/tools/rag-tools.js` — `suplagentics_search_code`, lines ~263–281.
**Problem:** references `reindexStaleInBackground` (line 274) and `reindexedCount` (line 278), neither
defined anywhere → `ReferenceError` on every query. The B-7 "return stale now, reindex in background"
refactor was left half-written. It also can't work as designed: `db` is closed in the handler's
`finally`, so a non-awaited background reindex would use a closed handle.
**Fix (synchronous inline reindex — matches original P0-2 intent, correct with the db lifecycle):**
1. Delete the `reindexStaleInBackground(...)` call and the `reindexedCount` staleness-note block.
2. After computing `staleFiles`, reindex them inline (we are still inside `try`, before `finally`):
   ```js
   let reindexedCount = 0;
   for (const f of staleFiles) { if (await reindexFile(db, dir, f)) reindexedCount++; }
   if (reindexedCount > 0) {
     // re-query against the now-fresh chunks
     rows = db.all('SELECT file_path,start_line,end_line,content,embedding FROM chunks WHERE workspace = ?', dir);
     scored = rows.map(/* same cosine map */).sort((a,b)=>b.score-a.score).slice(0, Math.min(top_k, 8));
   }
   const stalenessNote = reindexedCount > 0
     ? `\n\n[ℹ ${reindexedCount} file(s) re-indexed at query time — results are fresh]` : '';
   ```
3. `top_k ≤ 8` and only stale top-hit files reindex, so latency stays bounded.
**Verification:**
- [ ] `node -e "import('./src/tools/rag-tools.js')"` then exercise the handler against a small indexed
  dir — returns results, no ReferenceError.
- [ ] New test in `test/rag-tools.test.js` that invokes the `search_code` handler with a stubbed db and
  asserts it returns text (would have caught this).

## Fix 2 — [P0/security] `bash_cached` denylist blocks nothing
**Location:** `src/tools/cache-tools.js:32–39`.
**Problem:** patterns are written `/\brm\bs/i` — `\b` then a literal `s` (typo for `\s`). None match a
real command; `rm -rf`, `del`, `format c:`, `shutdown` all pass to `execSync`. Only `dd` (uses `\s+`)
is caught.
**Fix:**
1. Replace every `\bs` with `\s` (word boundary + whitespace), e.g. `/\brm\s/i`, `/\bdel\s/i`, …
2. Anchor to command start so `mydel.sh` isn't blocked but a leading `del ` is: `/(^|[;&|]\s*)rm\s/i`
   style, or keep `\b…\s` if simpler.
3. Reframe honestly: this is defence-in-depth, not a hard guarantee — it's bypassable via `/bin/rm`,
   `bash -c`, env indirection. Update the tool description + the `Command blocked` message accordingly.
**Verification:**
- [ ] Unit test: `isCommandDenied('rm -rf /tmp/x') === true` for rm/rmdir/del/format/mkfs/shutdown/
  reboot/halt; `false` for benign `git status`, `npm test`, `grep`.

## Fix 3 — [P1] `index.js` has no shutdown handling or health tool
**Location:** `src/index.js` (whole file — currently bare).
**Problem:** ledger claims A-2 (health tool + SIGINT/SIGTERM) and B-12 (`closeDb()` on shutdown to
checkpoint the import-queue WAL). None exist. `closeDb` is exported from
`capabilities/import/claude-import-db.js` but called nowhere.
**Fix:**
1. `import { closeDb } from './capabilities/import/claude-import-db.js';`
2. Register a `suplagentics_health` tool returning `{ ok:true, version, uptime, dbPath }`.
3. Add signal handlers — `closeDb` is `async` (verified), so await it before exit so the WAL checkpoint
   completes: `for (const sig of ['SIGINT','SIGTERM']) process.on(sig, async () => { try { await closeDb(); } finally { process.exit(0); } });`
4. Wrap `await server.connect(transport)` in try/catch → `console.error` + `process.exit(1)`.
**Verification:**
- [ ] Smoke-test from CLAUDE.md still lists tools, now including `suplagentics_health`.
- [ ] Send SIGINT to a running server → process exits cleanly; opencode.db WAL is checkpointed (no
  large `-wal` left behind).

## Fix 4 — [P1] embed-failure counter never fires (B-9)
**Location:** `src/tools/rag-tools.js:156` (in `reindexFile`) and `:213` (in `index_workspace`).
**Problem:** the `embedFailed++` increment sits in `reindexFile` where `embedFailed` is out of scope
(would throw, but is swallowed by the try/catch → `false`). In `index_workspace` the `if(!vec) continue`
path never increments, so the report always says 0 embed failures.
**Fix:** remove the stray `embedFailed++` in `reindexFile` (leave `continue`); in `index_workspace`
change line 213 to `if (!vec) { embedFailed++; continue; }`.
**Verification:** point at a dir with Ollama down mid-run (or a mocked `embed` returning null) → the
summary line reports a non-zero embed-failure count.

## Fix 5 — [P2] `bash_cached` still caches failures (B-6)
**Location:** `src/tools/cache-tools.js:132`.
**Problem:** the `catch` block calls `writeEntry(k, out)`, so a transient failure is cached and replayed
for the TTL.
**Fix:** return the error output without `writeEntry`.

## Fix 6 — [P2] `startCommanderSession` has no error handling (B-11)
**Location:** `src/agent-session-runner.js:130`.
**Problem:** unlike `runSubagentDelegation`, no try/catch — a failed `fetch` rejects to the caller with
no log.
**Fix:** wrap the body in try/catch, `console.error('[suplagentics] startCommanderSession failed: …')`,
return `{ ok:false, sessionId:null }`.

---

## Done when
- [ ] `search_code` returns results with no ReferenceError; handler-level test added.
- [ ] Denylist actually blocks the destructive set; unit test added.
- [ ] `index.js` has health tool + signal handlers + `closeDb` wired; startup errors reported.
- [ ] Embed-failure count is accurate; failures not cached; commander session logs errors.
- [ ] `node --test test/rag-tools.test.js` green; opencode restarted so the live server runs the fixes.

## Escape hatch
If the inline-reindex in Fix 1 proves too slow on a large workspace, fall back to: detect staleness,
skip reindex, and append a note telling the caller to run `index_workspace(force:true)` — still correct,
just not auto-fresh. Never leave the undefined references in place.
