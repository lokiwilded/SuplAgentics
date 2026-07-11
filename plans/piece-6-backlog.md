---
title: "Piece 6 + backlog — remaining next-level work (for PI-Builder)"
status: pending
created_at: 2026-07-11
type: backlog
owner: PI-Builder
---

# Piece 6 & backlog — hand-off for PI-Builder

Everything the 2026-07-10/11 "next-level" initiative deferred, consolidated so **PI-Builder**
(`D:\SuplAgentics\PI-Builder`, the second-layer Pi agent) can pick items off one at a time. Pieces
1–5 are DONE + merged to `master` (see `plans/next-level-initiative.md`). This file is the queue for
what's left + genuinely new capabilities.

## Ground rules for PI-Builder (do NOT skip)
- **Edit the repo, never live `~/.config/opencode/` directly.** Then `supl_sync push` → `supl_diff`
  must show **0 drift** → `supl_refresh` (adds `dash --build` for UI/route changes) → restart.
- **Prove it reached runtime.** Run the tool / restart opencode / hit the endpoint and observe — a
  green syntax check is NOT proof (that's the exact failure the whole audit was about).
- **Verify each fix, then update `plans/next-level-initiative.md`** with the commit + evidence.
- One item per PR/commit on a `backlog/<slug>` branch off `master`.

---

## A. Reliability / config (small, high-confidence)

### A1. Declare model context-limits so opencode stops failing on models.dev  ✅ DONE
**Fix (applied):** Added `provider.ollama-cloud.models` with `limit.context` and `limit.output`
for all 7 in-use models (glm-5.2, deepseek-v4-flash/pro, devstral-small-2:24b, minimax-m2.7,
gemma4:31b, gpt-oss:20b). Values sourced from the cached `~/.cache/opencode/models.json`.
Propagated to live via `supl_sync push` (deep-merge from A3). Committed in OC as `9f55920`.
**Verify:** restart opencode and check boot log for absence of models.dev fetch timeout.

### A2. stm summarizer cadence (optional, user preference)  [P3]
`~/.config/opencode/stm.jsonc` `remindEveryN: 4`. Leave unless the user asks — the churn was the
broken `minimax-m2.5-free` model retrying, already fixed to `deepseek-v4-flash`. Only a speed-vs-
memory-freshness dial.

### A3. Make `sync-self.mjs` config merge deep (so provider.options propagates)  ✅ DONE
**Fix (applied):** Replaced the shallow `{...src, ...dst}` merge in `syncConfig()` with a
recursive `deepMerge()` that recurses into nested objects on both sides, preserves dst values
on scalar conflicts (user customization), and only adds keys the user hasn't set. This lets
`provider.ollama-cloud.options.*` and `provider.ollama-cloud.models.*` propagate repo→live.
Committed in root repo as `dd463ff`.
**Verify:** `supl_sync push --dry` shows opencode.json (merged); `supl_diff` shows 0 drift.

---

## B. Memory & learning loop (Piece 3 leftovers)

### B1. Verify + wire automatic memory RETRIEVAL into agent context  [P2]
**Why:** memory STORAGE is automatic (opencode-mem wrote 46 shards/24h). Confirm the loop's other
half: that relevant memory is actually injected into an agent's context on a task (not just stored).
**Do:** trace opencode-mem's retrieval hook; run a task in a project with memory and confirm prior
learnings surface. If retrieval isn't wired/enabled, enable it.
**Verify:** ask an agent something it "learned" in a past session; it recalls without re-deriving.

### B2. Global improvement synthesis  [P2]
**Why:** `~/.config/opencode/improvements/` (global) is empty — global synthesis needs **2+ projects**
with per-project suggestions. Only `C:\Users\lokid\dev\SuplAgentics` has them (2).
**Do:** once a 2nd project accrues per-project suggestions, run a global scan
(`POST /api/suplagentics/improvement/investigate` scope=`global`, or the dashboard's global button)
and confirm `insights-global-synthesizer` produces cross-project suggestions.
**Verify:** ≥1 file appears in `~/.config/opencode/improvements/skills/`.

### B3. Memory hygiene / pruning  [P3]
opencode-mem (106 MB / 150 shards) + RAG index (140 MB) grow unbounded. Check whether opencode-mem
self-prunes; if not, add a periodic prune of stale/duplicate shards + a RAG `remove_workspace` sweep
for dead project paths. Low priority until it actually bloats.

---

## C. Plans & Annotator (Piece 4 leftover — the real one)

### C1. Server-side annotation persistence (cross-device)  ✅ DONE
**Fix (applied):** Added `GET/PUT /api/suplagentics/plans/annotations?path=<planPath>` routes in
`plan-routes.js` that store annotations in a `.annotations.json` sidecar next to the plan file.
Updated `useAnnotations.ts` to hydrate from server (canonical), fall back to localStorage (offline
cache), and write through to server with an 800ms debounce. Path-validated (no traversal, within
home dir). Committed in UI as `0786f09`. Dashboard rebuilt via `supl_refresh --build`.
**Verify:** annotate a plan on desktop, open the same plan on phone → annotations present.

---

## D. Dashboard UX (Piece 5 — minor polish, all P3)

### D1. `IndexingSettings.tsx` empty state — show "No workspaces indexed yet — index a project to
enable semantic search" when the list is empty (currently only a status line).
### D2. Persistent error surfacing — audit the three settings pages
(`Import/Improvement/IndexingSettings.tsx`) so a failed action shows a dismissible error banner, not
just a transient toast that's easy to miss.
### D3. Deep pass on the 19 `plan-annotator/` React components for correctness/UX (offset resolver
edge cases on heavily-edited plans, keyboard-shortcut conflicts). Not audited line-by-line yet.

---

## E. Structural (from the original audit, still open)

### E1. CI is disabled (`.github/workflows/ci.yml.disabled`) — it referenced OC/MCP/UI which the root
repo gitignores (not submodules, no remotes). Decide: git submodules + `checkout --recursive`, OR
per-repo CI. Add remotes if CI is meant to run. [P1 if CI matters]
### E2. Keep `plans/self-audit.md` honest — the "prove it reached runtime" rule now lives at its top;
demote any future ✅ that isn't verified.

---

## F. Genuinely NEW capabilities (Piece 6 proper — user to define)

Deliberately left for the user to name. Seeds from what we learned, none started:
- **Memory browser** — a dashboard view of what opencode-mem has learned per project (surfaces the
  106 MB that's currently invisible).
- **"Suggestions ready" nudge** — a gentle badge when a project accrues enough new memory to make a
  manual improvement scan worthwhile (keeps scans manual per the user's preference, just signals).
- **One-click "apply improvement"** — from an approved suggestion straight through build+verify+review
  with the hardened pipeline.
- (User's own ideas go here.)

---

## Done this initiative (context, no action)
Pieces 1–3 + 4-audit + 5-audit, all on `master`: js-verifier, adaptive fast-path, `suplagentics_redact`
tool, review-loop cap, hardened+child-aware delegation wait, stale-spinner fix, Ollama chunkTimeout,
restart ping, Improvements-loop brief+diagnosability fix (verified live). ~24 tests green. See
`plans/next-level-initiative.md`.
