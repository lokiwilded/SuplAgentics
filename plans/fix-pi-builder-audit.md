---
title: "PI-Builder — finish isolation + audit the extension"
status: done
scope: PI-Builder
created_at: 2026-07-10
type: plan
source: 2026-07-10 deep audit
---

# Plan: PI-Builder — the second layer

`PI-Builder/` is the Pi (`@earendil-works/pi-coding-agent`) harness that improves SuplAgentics from the
outside. It moved into the tree this session; isolation is mostly done, with two items left and one
un-audited surface.

## Repo context
- Now at `D:\SuplAgentics\PI-Builder`, its own git repo (branch `master`, commit `7fbef6f`), gitignored
  by the parent so its edits never mix into what it fixes.
- Tools are zero-dependency Node scripts in `tools/` (`npm run <script>`). `.pi/` holds the Pi runtime
  config + a custom extension.
- Its `findRoot()` walks up to the dir containing OC/MCP/UI → resolves to `D:\SuplAgentics` (verified).

---

## Done this session (verify only)
- **Isolation** — its own gitignored repo; `AGENTS.md` "Two workspaces" section corrected to reflect the
  nested-but-separate-repo arrangement. ✓
- **`opencode-status.js`** — new read-only stack health/activity checker (`npm run status`, `--json`,
  `--watch`); reads the restart breadcrumb the UI plan added. ✓

## Fix 1 — [P2] The `.pi` extension is un-audited
**Location:** `PI-Builder/.pi/extensions/suplagentics.ts` (implements the `supl_*` tools:
`supl_scan/diff/sync/refresh/read_convos/restart`).
**Problem:** these tools run git operations, filesystem sync, and read opencode sessions — real power,
never read in this pass.
**Fix:** audit it for: shelling out with unsanitized paths, `supl_read_convos` leaking secrets
(`auth.json`, `OLLAMA_API_KEY`, `.env`) into the model/corpus, and `supl_sync push` overwriting live
config destructively. Confirm it honors AGENTS.md's "never index or send secrets" rule.

## Fix 2 — [P2] The mined corpus may hold conversation content
**Location:** `PI-Builder/.pi/corpus/suplagentics.jsonl` (committed).
**Problem:** it's improvement-mining data derived from real sessions. Local-only today (no remote), so
low risk — but if PI-Builder ever gets a remote, that content ships with it.
**Fix:** confirm the corpus excludes secrets; if it can contain sensitive convo text, add
`.pi/corpus/` to `PI-Builder/.gitignore` (regenerable) rather than tracking it. Decide before adding any
remote.

## Fix 3 — [P3] No tests on the tools
**Location:** `PI-Builder/tools/*.js`.
**Problem:** `opencode-status.js`, `diff-live.js`, `sync.js` have no tests; a parsing regression is
silent.
**Fix:** add a minimal smoke test (parse a captured `opencode.log` fixture, assert the status
classifier returns the expected state). Low priority.

---

## Done when
- [ ] `.pi/extensions/suplagentics.ts` audited; confirmed no secret leakage and no destructive sync path.
- [ ] Corpus secret-safety confirmed, or `.pi/corpus/` gitignored.
- [ ] Decision recorded on whether PI-Builder ever gets a remote (drives the corpus call).

## Escape hatch
PI-Builder is isolated and functional now; none of this is urgent. If the extension audit finds a
secret-leak path, that jumps to P1 — treat it like the MCP P0s.
