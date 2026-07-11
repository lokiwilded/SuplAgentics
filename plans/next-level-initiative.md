---
title: "SuplAgentics — next-level initiative (living plan)"
status: in-progress
created_at: 2026-07-10
type: initiative
---

# Next-level initiative — vision + build plan

**Process:** flesh out the vision **piece by piece** (user reacts to options) → THEN implement per
piece → then delete scaffolding. Keep the existing flow. Focus reliability + agent cohesion. Big new
capabilities come LAST.

**Constraints:** opencode = SuplAgentics only · `pi` = PI-Builder only · must be rock-solid on Ollama
Cloud (`ollama-cloud`, https://ollama.com/v1).

## Pieces
1. Agent orchestration — ✅ **IMPLEMENTED + verified** (branches `next-level`)
2. Runtime reliability — ✅ core DONE (both 🔴); #3/#4/#5 minor/optional
3. Memory & learning loop — ✅ DONE (works, verified live; storage/retrieval auto)
4. Plans & Annotator — ✅ audited sound (annotation-sync → backlog C1)
5. Dashboard UX — ✅ audited decent; polish → backlog D
6. New capabilities + all leftovers → plans/piece-6-backlog.md

## Branches
All initiative work is on `next-level` branches (OC/MCP), separate from `master` (the stable
post-audit baseline). Merge to master per-milestone. To go live: `sync-self.mjs push` (OC) + restart
opencode (MCP runs from the repo path, so its changes are live on restart).

---

## Piece 1 — Agent orchestration (LOCKED 2026-07-10, all 5 approved)

1. **[🔴 P0] JS/TS verifier.** Verifiers exist for `.liquid`/`.py`/`.astro` but NOT JS/TS — the
   languages SuplAgentics and most projects use, so they currently skip verification and jump
   straight to reviewer. Add a `js-verifier` subagent (`tsc --noEmit` + eslint + `node --test`) and
   wire it into commander MANDATORY-flow step 7 (`.js/.ts/.tsx/.mjs/.cjs` → js-verifier).
2. **[🟠] Adaptive fast-path.** The full guardian→researcher→verifier→reviewer chain runs even for a
   one-line change (6+ model calls) → slow + more stall points. Let commander skip guardian+researcher
   for trivial/no-secret tasks and skip reviewer for pure-doc changes.
3. **[🟠] Guardian → inline sanitizer.** Replace the guardian delegation hop with an instant regex
   redact (reuse PI-Builder `.pi/extensions/suplagentics.ts` `redact()` pattern) so no round-trip.
4. **[🟡] Cap the review→fix loop** at ~2 rounds, then report what's left (prevents ping-pong).
5. **[🟡] Harden the delegation wait** (`agent-session-runner.js` `waitForTurnToConclude`) so one hung
   subagent doesn't freeze the whole chain up to the 10-min ceiling — faster stall detection/retry.

**✅ IMPLEMENTED + verified 2026-07-10:**
- `@js-verifier` subagent + commander wiring (validate-agents clean). — OC `a182a73`
- Adaptive fast-path + review-loop cap (commander). — OC `a182a73`
- `suplagentics_redact` MCP tool (+ tests: redacts real formats, no false positives) — commander now
  uses it instead of the @guardian round-trip. — MCP `b6694a3`, OC `19ac159`
- Hardened `waitForTurnToConclude` — returns {concluded, reason}, fast-bails a failed-to-start
  subagent at 60s, retries transient DB errors, env-tunable. — MCP `b6694a3`
- MCP suite 12/12 green.

---

## Piece 2 — Runtime reliability (vision set; each item needs a VERIFIED impl)

Approved gaps (from the walkthrough): 1) stale-spinner reconnect, 2) Ollama Cloud resilience,
3) plugin-roster audit, 4) models.dev unreachable, 5) surface restarts in UI.

**✅ #1 stale spinner — DONE + tested (UI `2a85f4e`).** Root cause: `resetAllSessionActivityToIdle()`
had ZERO call sites and didn't broadcast, so a turn killed mid-restart stayed `busy` forever. Now it
broadcasts idle (reusing the event the UI already handles) and is called from `restartOpenCode()`.
Server-side fix — the browser never disconnects from the dashboard, so no client reconnect needed. +1 test.

**✅ #2 Ollama Cloud resilience — DONE (OC `e1f3f91` + live).** Schema-verified (opencode.ai/config.json):
no retry option exists, but `timeout`/`headerTimeout`/`chunkTimeout` do. Set `headerTimeout=60000`,
`chunkTimeout=180000` on the `ollama-cloud` provider → a stalled stream fails clean+fast instead of
hanging; #1 + the health-monitor recover it. Generous values so cold-starts aren't killed. (Applied
to live directly too — sync-self's shallow merge can't propagate nested provider.options.)

**Investigated, deliberately NOT over-built (honest conclusions):**
- **#3 plugin roster:** the 3 memory plugins are COMPLEMENTARY (opencode-mem=long-term, stm=session
  summaries, compact=context) — nothing to remove. Only tunable: stm `remindEveryN:4` churn (a
  preference; leave to the user).
- **#4 models.dev:** not blocked — the api.json is ~3MB and opencode's fetch times out on this
  connection. NON-FATAL (falls back to defaults). Proper fix = declare model context-limits in config
  (data-heavy); low priority, not faked.
- **#5 surface restarts in UI:** downgraded to optional polish — #1 already clears the stuck spinner,
  so a restart is no longer a mystery hang. A "opencode restarted" toast would be transparency only.

**Piece 2 substantive work (both 🔴) DONE + verified.** Remaining items are minor/optional by design.
Plus **#5 restart ping** shipped (UI `efda2a9`) and **stm churn** needs no change (the churn was the
broken `minimax-m2.5-free` model retrying — already fixed to deepseek-v4-flash this session).

---

## Piece 3 — Memory & learning loop (started, #1 first)

**User preference (locked):** memory **storage + retrieval = automatic**; **Improvements = manual
trigger** but must actually WORK when triggered. Don't auto-schedule improvement scans.

**Substrate is healthy:** opencode-mem 150 shards / 106 MB, RAG index 140 MB, and `search_code`
(dead until this session) now retrieves. **But `improvements/` = 0 files ever** — the learning half
never closed.

**#1 make the Improvements loop produce — IN PROGRESS.**
- Code-level fixes shipped (MCP `ab06687`): the insights-agent brief was too thin (no directory →
  no `project_path` for the opencode-mem SQL filter, no write path) — now concrete; and the silent
  `catch {}` now logs + reports honestly (distinguishes "nothing met the bar" from "the turn never ran").
- **Suspected deeper cause:** the scan hijacks a *commander* session and tells it "just task
  insights-X and do nothing else" — but commander's own system prompt heavily biases it toward its
  MANDATORY flow. Need to trigger live and watch whether commander cleanly tasks the insights agent.
- **NEXT (needs live):** push OC + restart, trigger a project scan (or `POST /api/suplagentics/
  improvement/investigate`), watch the delegation in the log with the new diagnosability.

**LIVE RESULT (2026-07-11, after push+dash+restart):** the loop **WORKS**. Triggered a project scan
for `C:\Users\lokid\dev\SuplAgentics` (312 memories) → insights-skills ran deepseek-v4-pro (real
multi-step analysis) → concluded cleanly → honestly reported "no skills pattern met the bar" (0 new,
because 2 real suggestions already exist there: *Agent Config Consistency Checker*, *File-Write Output
Verification*). **CORRECTION to earlier finding:** the loop was NEVER dead — my "0 files" checked the
GLOBAL dir (`~/.config/opencode/improvements`, legitimately empty until 2+ projects have suggestions);
project-scoped mining works and has produced real suggestions.

**Refinement found live (open):** `waitForTurnToConclude` watches the PARENT delegation session, but
the insights agent runs in a CHILD session — so the parent idles during the child's work and the scan
can mark "done/found 0" before the agent finishes writing. Files still get written (opencode's `task`
blocks until the subagent returns), so nothing is lost, but the immediate count lags. Fix: make
`getLastActivityAt` include child sessions (`part WHERE session_id = ? OR session_id IN (SELECT id
FROM session WHERE parent_id = ?)`).

**#1 status: WORKS + verified live** (thin-brief + silent-catch fixed; honest reporting confirmed).
**#2 automatic memory ingestion, #3 verify retrieval is used, #4 hygiene, + the child-session wait
refinement — next.**
