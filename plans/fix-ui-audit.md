---
title: "UI — fix audit findings (1 P2 + deferred React pass)"
status: done
scope: UI
created_at: 2026-07-10
type: plan
source: 2026-07-10 deep audit
---

# Plan: UI — dashboard correctness

`UI/` is the OpenChamber fork + our custom surface. The audit found the security fixes here are
genuine (unlike MCP's) — one real correctness bug remains, plus one already fixed this session, plus a
deferred React pass.

## Repo context
- Stack: React (`packages/ui`, Vite build → `dist/`) + Express server (`packages/web/server`).
- Server runs from source via bun (`bun .../server/index.js`); server-only edits apply on dashboard
  restart. React edits need `bun run build`.
- Custom surface: `packages/web/server/lib/suplagentics/*` + `packages/ui/src/components/.../suplagentics/`.

---

## Fix 1 — [P2] `escapeLike` is wrong at both of its two call sites (different bugs)
**Location:** `packages/web/server/lib/suplagentics/plan-routes.js:32` (`escapeLike`), used at `:44` and
`:144`. Verified 2026-07-10: there is exactly ONE `LIKE` query (line 52); the second usage is a plain
string `===` comparison. So the single fix in the original plan was wrong — split into two:

**Fix 1a — line 52 (`findCreatingSessionForPlanPath`): real LIKE, add the ESCAPE clause.**
The query builds `%${targetName}%` and runs `... LIKE ?` with no `ESCAPE '\'`, so SQLite treats the
`\` from `escapeLike` literally — `%` still wildcards and an `_` filename (now `\_`) fails to match.
Append the clause:
```sql
AND json_extract(p.data,'$.state.input') LIKE ? ESCAPE '\'
```

**Fix 1b — line 144 (`findSessionIdInSuplagenticsTracking`): NOT a LIKE query — remove `escapeLike`.**
Here `targetName = escapeLike(path.basename(planFilePath))` is compared with `===` against
`path.basename(record.file)`. Escaping corrupts the exact match: `my_plan.md` becomes `my\_plan.md`
which never equals the real basename. Drop the wrapper:
```js
const targetName = path.basename(planFilePath);   // was: escapeLike(path.basename(...))
```

**Verification:**
- [ ] A plan file with an underscore (e.g. `plans/fix_me.md`) resolves its creating session via BOTH
  paths (the DB LIKE path and the suplagentics-tracking `===` path).
- [ ] A filename with a literal `%` doesn't wildcard-match unrelated sessions in the LIKE path.

## Already fixed this session (verify only)
- **Health-monitor mid-turn restarts** — `packages/web/server/lib/opencode/lifecycle.js` (committed on
  `audit-fixes`, `dbea186`). Probe timeout 5s→10s, busy grace 2min→10min, restart breadcrumb to
  `~/.local/share/opencode/log/openchamber-restarts.log`. Tests green (6/6). No action beyond keeping it.

## Verified genuine (no action)
- `enforceSameOrigin` + rate limit (S-3), path-traversal guard `isPathWithin` (S-1), installer
  all-packages `.every()` (C-5), cross-drive `resolveAllProjectDirectories`. All real.

---

## React surface — audited 2026-07-10, CLEARED (no XSS vector)
- No `dangerouslySetInnerHTML` / `innerHTML` / `v-html` anywhere in the suplagentics UI.
- The plan annotator renders untrusted plan/session text through a custom block-level markdown
  parser (`plan-annotator/markdown.ts`, MIT port) into a typed Block tree rendered by React
  components — NOT via HTML injection. React escapes text content, so imported session text cannot
  inject markup.
- Residual (low): the custom parser processes untrusted text; a malformed-input parser bug would be
  a correctness/DoS concern, not XSS. Not pursued — no dangerous surface.

## Done when
- [ ] `ESCAPE '\'` added to all `escapeLike` queries; underscore-filename lookup verified in the dashboard.
- [ ] Dashboard restarted; Plans panel resolves sessions correctly.
- [ ] A follow-up plan exists for the React annotator audit (or it's done).

## Escape hatch
If underscores never appear in real plan filenames (they're kebab-case by convention), Fix 1 is low
urgency — but the ESCAPE clause is a one-line correctness win, do it anyway.
