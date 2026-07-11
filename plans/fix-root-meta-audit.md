---
title: "root/meta — CI, the ledger, docs, branch merge"
status: done
scope: root
created_at: 2026-07-10
type: plan
source: 2026-07-10 deep audit
---

# Plan: root / meta-repo

The root repo tracks docs + tooling and treats `OC/ MCP/ UI/ PI-Builder/` as gitignored sibling repos.
The audit found the cross-cutting problems the four folder plans don't own: a CI pipeline that cannot
run, an unreliable audit ledger, stale docs, and the `audit-fixes` branches to reconcile.

## Repo context
- Root on branch `audit-fixes` (2 commits this session). `.gitignore` excludes OC/MCP/UI/PI-Builder.
- No `.gitmodules`; no git remotes anywhere (all repos local-only).

---

## Fix 1 — [P1] CI is structurally impossible to run
**Location:** `.github/workflows/ci.yml`.
**Problem:** jobs use `working-directory: MCP` and `validate-agents.js OC/`, but the root repo tracks
zero files under those paths (they're gitignored, independent repos, not submodules). A GitHub checkout
of root contains none of them → every job fails. There's also no remote, so nothing triggers CI at all.
**Fix (pick one):**
- **A — submodules:** convert OC/MCP/UI (+ maybe PI-Builder) to git submodules of root; CI does
  `checkout --recursive`. Cleanest for a single-repo CI, but changes the day-to-day git workflow.
- **B — per-repo CI:** move the relevant CI steps into each sub-repo's own `.github/workflows/`. Matches
  the "each folder is its own repo" model. Root CI then only checks `start.mjs`/`sync-self.mjs`.
- Either way: add remotes if CI is meant to actually run, or delete `ci.yml` and stop claiming D-3 is done.
**Verification:** a pushed commit triggers a run that actually finds the dirs and goes green.

## Fix 2 — [P1/process] Rewrite the self-audit ledger to match reality
**Location:** `plans/self-audit.md`.
**Problem:** the deep audit confirmed ≥5 items marked `✅ RESOLVED` are absent or broken (search_code,
denylist, index.js A-2/B-12, embed-failure B-9, CI D-3; partially B-6/B-11). The ledger is a to-do
list masquerading as a record.
**Fix:**
1. Re-verify every `✅ RESOLVED` line against the actual code (read + run); demote the false ones back to
   open, linked to the relevant folder plan.
2. Add a rule at the top: **nothing is marked resolved until it's proven to reach the running system**
   (run the tool / restart opencode / hit the endpoint) — PI-Builder's core mandate, applied to the
   ledger itself.
3. Point the open items at `plans/fix-*-audit.md`.

## Fix 3 — [P2] Docs describe the old three-folder shape
**Location:** `README.md`, `CLAUDE.md`, `VERSIONS.md`.
**Problem:** all say "three folders"; PI-Builder (the fourth component) is undocumented; the VERSIONS
matrix omits it.
**Fix:** update to four components; add a short PI-Builder section (second layer, its own gitignored
repo, `npm run status`); add a PI-Builder row/column to VERSIONS.md.

## Fix 4 — [P2] Reconcile the `audit-fixes` branches
**Location:** all five repos (root, OC, MCP, UI on `audit-fixes`; PI-Builder on `master`).
**Problem:** this session's work + all previously-uncommitted audit fixes live on `audit-fixes` branches,
unmerged. Fine as a safety checkpoint, but decide the destination.
**Fix:** after the folder-plan fixes land on `audit-fixes`, review each repo's diff and merge to
`master` (or open PRs if remotes get added). Keep the branches until the P0s are fixed + verified.

---

## Done when
- [ ] CI either runs green (submodules or per-repo) or is honestly removed.
- [ ] `self-audit.md` reflects real state; false RESOLVEDs demoted; "prove it reached runtime" rule added.
- [ ] Docs say four components; PI-Builder documented; VERSIONS updated.
- [ ] `audit-fixes` branches reviewed and merged (or intentionally kept pending the P0 fixes).

## Escape hatch
If the submodule-vs-per-repo CI decision stalls, do the zero-risk parts now (ledger rewrite + docs) and
leave `ci.yml` disabled (rename to `ci.yml.disabled`) so it stops implying a passing pipeline.
