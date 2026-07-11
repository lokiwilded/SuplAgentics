// Drip-feeds the pending_chunks queue through the claude-import-summarizer subagent, and pushes
// already-imported memory_files into opencode-mem's real API. Moved from the OpenChamber fork's
// packages/web/server/lib/suplagentics/import-routes.js (see the approved MCP server
// architecture plan, section 2).

import { status as dbStatus, getUnpushedMemoryFiles, markMemoryFilePushed, getProjectPath } from './claude-import-db.js';
import { computeContainerTag, postMemory } from './opencode-mem-client.js';
import { runSubagentDelegation } from '../../agent-session-runner.js';
import { ensureSuplagenticsHome } from '../../suplagentics-home.js';

export function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Summarizer batch: session-based invocation via the shared runner, not CLI spawn ---
// See agent-session-runner.js's header comment for why (claude-import-summarizer.md is mode:
// subagent, and `opencode run --agent X` silently falls back to the default agent for those).
export let summarizing = false;

// Stall detection — a chunk the summarizer can never finish (push failures, content the model
// chokes on, opencode-mem down at :4747) stays 'pending' forever by design (the agent is told
// to leave failed rows for retry). Without this, the drip-feed loop below re-spawned a fresh
// session every ~40s against the same unprocessable chunk indefinitely — a real observed
// "indexer stuck on the last session" failure. Progress is measured by chunksDone increasing
// (never decreases, and is immune to a concurrent import inserting new pending rows), and one
// full batch turn with zero newly-done chunks marks the queue stalled instead of looping.
// Mutated in place (never reassigned) so importers holding a reference always see live state.
export const indexerState = { stalled: false, stalledAt: 0, stalledPending: 0 };
export function clearIndexerStall() {
  indexerState.stalled = false;
  indexerState.stalledAt = 0;
  indexerState.stalledPending = 0;
}

export async function spawnSummarizerBatch({ buildOpenCodeUrl, getOpenCodeAuthHeaders }) {
  if (summarizing) return;
  summarizing = true;
  let sessionCreated = false;
  let doneBefore = null;
  try {
    doneBefore = (await dbStatus()).chunksDone;
    const result = await runSubagentDelegation({
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      directory: ensureSuplagenticsHome(),
      title: 'Import summarization batch',
      subagentName: 'claude-import-summarizer',
      instruction: 'Summarize the next pending batch of imported transcript chunks.',
    });
    sessionCreated = result.ok;
  } catch {
    // transient — next status poll (or the next import) will retry via the resume-on-view check
  } finally {
    summarizing = false;
  }
  if (!sessionCreated) return;
  const s = await dbStatus();
  if (s.chunksPending <= 0) {
    clearIndexerStall();
    return;
  }
  if (doneBefore !== null && s.chunksDone <= doneBefore) {
    indexerState.stalled = true;
    indexerState.stalledAt = Date.now();
    indexerState.stalledPending = s.chunksPending;
    return;
  }
  clearIndexerStall();
  spawnSummarizerBatch({ buildOpenCodeUrl, getOpenCodeAuthHeaders });
}

export const pushing = new Set();
const PUSH_BATCH_SIZE = 25;
const PUSH_PACE_MS = 750;
export async function processMemoryPushQueue() {
  if (pushing.size > 0) return;
  pushing.add('running');
  try {
    let rows = await getUnpushedMemoryFiles(PUSH_BATCH_SIZE);
    while (rows.length > 0) {
      for (const row of rows) {
        const projectPathValue = await getProjectPath(row.project_id);
        if (!projectPathValue) { await markMemoryFilePushed(row.id); continue; }
        const { containerTag, projectPath, projectName } = computeContainerTag(projectPathValue);
        const content = row.description ? `${row.description}\n\n${row.content}` : row.content;
        const result = await postMemory({ content, containerTag, type: row.type || undefined, projectPath, projectName });
        if (result.ok) await markMemoryFilePushed(row.id);
        await delay(PUSH_PACE_MS);
      }
      rows = await getUnpushedMemoryFiles(PUSH_BATCH_SIZE);
    }
  } finally {
    pushing.delete('running');
  }
}
