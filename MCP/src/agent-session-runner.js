// Moved verbatim from the OpenChamber fork's packages/web/server/lib/suplagentics/agent-session-
// runner.js (see the approved MCP server architecture plan, section 2). Lives at this package's
// top level, not under capabilities/, since it's shared across the import AND improvement
// capabilities alike, not specific to either one.
//
// Any SuplAgentics batch agent (claude-import-summarizer, the insights-* family, etc.) needs this
// same mechanism, not `opencode run --agent X` CLI spawn:
//
// Verified live: creating a session with `agent: X` reports that agent back correctly at
// creation time, but the moment a real prompt is actually processed, opencode silently
// reassigns the session to the default agent (commander) if X is mode: subagent — the same
// primary-only restriction the CLI enforces ("agent X is a subagent, not a primary agent.
// Falling back to default agent"), just applied one step later instead of at creation. This
// matters because these batch agents are deliberately mode: subagent — they must never clutter
// the interactive chat mode picker.
//
// The fix: don't specify an agent at session-creation (it'll be commander), and make the
// *prompt itself* explicitly instruct delegation via the `task` tool. `task`-based subagent
// invocation has no primary/subagent restriction at all (that's literally what `task` is for) —
// being explicit removes any dependency on commander's own judgment/overhead to get there
// organically (verified live: it does figure this out on its own eventually, just slower and
// less reliably every cycle).
//
// Completion signal: a single prompt_async turn does ONE bounded unit of work, then the turn
// ends — it does not loop on its own until some external job queue is fully drained. The real
// "is this turn done" signal is opencode.db's own part table for that session going quiet for a
// settling window, not any job-queue-specific condition (which varies per caller and wouldn't
// belong in a shared helper anyway).
//
// This module never imports OpenChamber's own opencode lifecycle/process-management directly —
// buildOpenCodeUrl/getOpenCodeAuthHeaders are always passed in as parameters, which is exactly
// what makes it callable from a standalone MCP server context (no managed opencode process to
// reference) just as easily as from the fork's own Express routes.

import { openDb } from './sqlite-runtime.js';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';

const OPENCODE_DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getLastActivityAt(sessionId) {
  if (!existsSync(OPENCODE_DB_PATH)) return null;
  const db = await openDb(OPENCODE_DB_PATH, { readonly: true });
  try {
    // Include child sessions: a `task`-delegated subagent (insights-*, verifiers, etc.) runs in its
    // OWN child session, so watching only the parent would let the wait conclude while the subagent
    // is still working. Count activity across the session AND any whose parent_id is it.
    return db.get(
      'SELECT MAX(time_created) as t FROM part WHERE session_id = ? OR session_id IN (SELECT id FROM session WHERE parent_id = ?)',
      sessionId, sessionId,
    )?.t ?? null;
  } finally {
    db.close();
  }
}

const parseMs = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const TURN_POLL_MS = 5_000;
const TURN_IDLE_SETTLE_MS = parseMs(process.env.SUPLAGENTICS_TURN_IDLE_SETTLE_MS, 25_000); // no new part activity for this long -> turn concluded
const TURN_MAX_WAIT_MS = parseMs(process.env.SUPLAGENTICS_TURN_MAX_WAIT_MS, 10 * 60 * 1000); // hard ceiling per single-turn wait
const TURN_START_GRACE_MS = parseMs(process.env.SUPLAGENTICS_TURN_START_GRACE_MS, 60_000); // no assistant output at all within this -> failed to start

// Waits for one delegated turn to conclude. Returns { concluded, reason } so the caller can tell a
// clean finish (idle-settle) from a stall (failed-to-start / max-wait-timeout) instead of treating
// every wait as success. A transient DB read error is retried, never fatal to the wait.
async function waitForTurnToConclude(sessionId) {
  const startedAt = Date.now();
  let lastActivityAt = Date.now();
  let lastSeenTime = null;
  let baseline;
  while (Date.now() - startedAt < TURN_MAX_WAIT_MS) {
    await delay(TURN_POLL_MS);
    let latest;
    try { latest = await getLastActivityAt(sessionId); }
    catch { continue; } // transient DB lock — keep waiting rather than aborting the whole delegation
    if (baseline === undefined) baseline = latest; // MAX(time_created) at first poll ≈ the prompt part
    if (latest !== lastSeenTime) {
      lastSeenTime = latest;
      lastActivityAt = Date.now();
    } else if (Date.now() - lastActivityAt >= TURN_IDLE_SETTLE_MS) {
      const produced = latest != null && latest !== baseline;
      return { concluded: true, reason: produced ? 'idle-settle' : 'no-assistant-output' };
    }
    // Fast bail: no assistant output at all within the start grace — the subagent likely failed to
    // start. Don't sit on the 10-minute ceiling waiting for something that will never come.
    if ((latest == null || latest === baseline) && Date.now() - startedAt >= TURN_START_GRACE_MS) {
      return { concluded: false, reason: 'failed-to-start' };
    }
  }
  return { concluded: false, reason: 'max-wait-timeout' };
}

// Runs one bounded turn: creates a session (default agent, i.e. commander), sends a prompt that
// explicitly instructs delegating to `subagentName` via `task`, and waits for that turn to
// conclude (not for any caller-specific job-queue condition — callers check their own completion
// signal, e.g. a DB row count, after this resolves).
//
// directory: forward-slash, not path.join's backslashes on Windows — verified live that a
// backslash directory here causes the created session to silently fall back to a different agent
// than requested, unrelated to the mode:subagent issue above.
export async function runSubagentDelegation({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  directory,
  title,
  subagentName,
  instruction,
}) {
  let sessionId = null;
  try {
    const sessionUrl = new URL(buildOpenCodeUrl('/session', ''));
    sessionUrl.searchParams.set('directory', directory);
    const sessionRes = await fetch(sessionUrl.toString(), {
      method: 'POST',
      headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!sessionRes.ok) return { ok: false, sessionId: null };
    const session = await sessionRes.json();
    sessionId = session.id;

    const promptUrl = new URL(buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}/prompt_async`, ''));
    promptUrl.searchParams.set('directory', directory);
    await fetch(promptUrl.toString(), {
      method: 'POST',
      headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        parts: [{
          type: 'text',
          text: `Use the task tool to delegate directly to the ${subagentName} subagent (subagent_type: "${subagentName}") with this exact instruction, and do nothing else yourself: "${instruction}"`,
        }],
      }),
    });

    // Give the model a moment to actually start (its first part write) before polling for idle,
    // so a slow start isn't mistaken for "already concluded."
    await delay(5_000);
    const outcome = await waitForTurnToConclude(sessionId);
    if (!outcome.concluded) {
      console.warn(`[suplagentics] runSubagentDelegation: turn did not conclude cleanly (${outcome.reason}) subagent=${subagentName} session=${sessionId}`);
    }
    return { ok: true, sessionId, concluded: outcome.concluded, reason: outcome.reason };
  } catch (error) {
    console.error(`[suplagentics] runSubagentDelegation failed (session=${sessionId}): ${error?.message || error}`);
    return { ok: false, sessionId };
  }
}

// Creates a real session running commander directly (no task-delegation wrapper) with a given
// prompt, and returns immediately without waiting for it to conclude — for cases like "Build",
// where the point is to hand the user off to a real, watchable session in Chat, not to wait for
// a bounded background job. commander is mode: primary, so no subagent workaround is needed here.
export async function startCommanderSession({ buildOpenCodeUrl, getOpenCodeAuthHeaders, directory, title, prompt }) {
  let sessionId = null;
  try {
    const sessionUrl = new URL(buildOpenCodeUrl('/session', ''));
    sessionUrl.searchParams.set('directory', directory);
    const sessionRes = await fetch(sessionUrl.toString(), {
      method: 'POST',
      headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'commander', title }),
    });
    if (!sessionRes.ok) return { ok: false, sessionId: null };
    const session = await sessionRes.json();
    sessionId = session.id;

    const promptUrl = new URL(buildOpenCodeUrl(`/session/${encodeURIComponent(session.id)}/prompt_async`, ''));
    promptUrl.searchParams.set('directory', directory);
    await fetch(promptUrl.toString(), {
      method: 'POST',
      headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
    });

    return { ok: true, sessionId: session.id };
  } catch (error) {
    console.error(`[suplagentics] startCommanderSession failed (session=${sessionId}): ${error?.message || error}`);
    return { ok: false, sessionId };
  }
}
