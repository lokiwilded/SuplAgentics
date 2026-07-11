// Scanning/investigation logic for Improvement suggestions — reads opencode-mem's real shards to
// know when a project has new data worth analyzing, and delegates the actual analysis to the
// insights-* subagent family via the shared session runner. Moved from the OpenChamber fork's
// packages/web/server/lib/suplagentics/improvement-routes.js (see the approved MCP server
// architecture plan, section 2).
//
// TRACKING_PATH and the single-lock runningScan state move here too, not just the pure scan call
// itself — the "only one scan at a time" invariant and the "don't re-scan a project that hasn't
// changed" cooldown are both properties of scanning itself, not of the Express route layer, so
// any caller of runCategoryScan (the fork's dashboard today, potentially an MCP tool or another
// client tomorrow) should see and respect the same shared state rather than each maintaining an
// independent copy that could scan the same project concurrently.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../sqlite-runtime.js';
import { runSubagentDelegation } from '../../agent-session-runner.js';
import { GLOBAL_IMPROVEMENTS_DIR, SUPLAGENTICS_HOME, countSuggestions } from './suggestions.js';

const MEM_DATA_DIR = path.join(os.homedir(), '.opencode-mem', 'data');
const TRACKING_PATH = path.join(os.homedir(), '.config', 'opencode', 'suplagentics-improvements.json');

function readTracking() {
  try { if (existsSync(TRACKING_PATH)) return JSON.parse(readFileSync(TRACKING_PATH, 'utf8')); } catch { /* first run */ }
  return {};
}

function writeTracking(data) {
  mkdirSync(path.dirname(TRACKING_PATH), { recursive: true });
  writeFileSync(TRACKING_PATH, JSON.stringify(data, null, 2));
}

// Finds a project's opencode-mem shard DB by scanning shards for one whose memories.project_path
// matches — avoids re-implementing opencode-mem's own git-identity hashing.
export async function findProjectShard(directory) {
  const metaPath = path.join(MEM_DATA_DIR, 'metadata.db');
  if (!existsSync(metaPath)) return null;
  const meta = await openDb(metaPath, { readonly: true });
  try {
    const shards = meta.all("SELECT db_path FROM shards WHERE scope = 'project'");
    for (const s of shards) {
      const shardPath = path.join(MEM_DATA_DIR, s.db_path);
      if (!existsSync(shardPath)) continue;
      const db = await openDb(shardPath, { readonly: true });
      try {
        const row = db.get('SELECT 1 FROM memories WHERE project_path = ? LIMIT 1', directory);
        if (row) return shardPath;
      } finally {
        db.close();
      }
    }
  } finally {
    meta.close();
  }
  return null;
}

export async function latestMemoryTs(directory) {
  const shardPath = await findProjectShard(directory);
  if (!shardPath) return 0;
  const db = await openDb(shardPath, { readonly: true });
  try {
    const row = db.get('SELECT MAX(updated_at) as ts FROM memories WHERE project_path = ?', directory);
    return row?.ts || 0;
  } finally {
    db.close();
  }
}

export function getTracking(directory, kind) {
  const tracking = readTracking();
  return tracking[`${directory}:${kind}`]?.lastAnalyzedAt || 0;
}

// ─── Scanning — single-lock model, same as the old stack ───────────────────
// Only one scan runs at a time. Phase text is honest, not simulated: this orchestrator has no
// visibility into what's happening inside the delegated subagent turn, so there's no "scanning
// memories"/"running YAGNI ladder" text pretending to know an internal step — just
// spawning/running/done.
export let runningScan = { active: false, kind: null, scope: null, directory: null, phase: 'idle', found: 0, details: '' };

function totalSuggestionCountForKind(directories, kind) {
  let total = countSuggestions(GLOBAL_IMPROVEMENTS_DIR, kind);
  for (const dir of directories) total += countSuggestions(path.join(dir, 'improvements'), kind);
  return total;
}

// scope 'project': directory required, uses insights-<kind>. scope 'global': synthesizes from
// every OTHER tracked project's own per-project suggestions (per insights-global-synthesizer.md
// — never scans raw memory itself), so it needs the full list of tracked directories from the
// caller (this capability has no project list of its own to consult).
export async function runCategoryScan(deps, kind, scope, directory, allProjectDirectories) {
  let dir, subagentName, instruction;
  if (scope === 'project') {
    dir = directory;
    subagentName = `insights-${kind}`;
    instruction = `Analyze the project at ${directory} for ${kind} suggestions. Mine its opencode-mem shard (the row set: memories WHERE project_path = "${directory}"), walk the YAGNI ladder, and write each surviving candidate to ${directory}/improvements/${kind}/<kebab-name>.md in the required frontmatter format. If no real recurring pattern is found, say so plainly — do not invent one.`;
  } else {
    const dirs = Array.isArray(allProjectDirectories) ? allProjectDirectories : [];
    const projectDirsPosix = dirs.map((d) => path.join(d, 'improvements', kind).split(path.sep).join('/'));
    const globalKindDirPosix = path.join(GLOBAL_IMPROVEMENTS_DIR, kind).split(path.sep).join('/');
    dir = SUPLAGENTICS_HOME;
    subagentName = 'insights-global-synthesizer';
    instruction = `Synthesize ${kind} suggestions. Per-project directories to read (any status counts as source material): ${projectDirsPosix.join(', ') || '(no tracked projects)'}. Existing global directory (to avoid duplicating): ${globalKindDirPosix}.`;
  }

  runningScan = { active: true, kind, scope, directory: directory || null, phase: 'spawning', found: 0, details: '' };
  try {
    const scanDirs = scope === 'global' ? (allProjectDirectories || []) : [directory];
    const before = totalSuggestionCountForKind(scanDirs, kind);
    runningScan.phase = 'running';
    const outcome = await runSubagentDelegation({
      ...deps,
      directory: dir,
      title: `Investigate ${kind} (${scope})`,
      subagentName,
      instruction,
    });
    if (outcome && outcome.concluded === false) {
      console.warn(`[improvement] ${subagentName} (${scope}) did not conclude cleanly: ${outcome.reason}`);
    }
    const after = totalSuggestionCountForKind(scanDirs, kind);
    const found = after - before;

    if (scope === 'project') {
      const tracking = readTracking();
      tracking[`${directory}:${kind}`] = { lastAnalyzedAt: Date.now() };
      writeTracking(tracking);
    }

    // Honest detail: distinguish "analyzed, nothing met the bar" (a legitimate 0) from "the
    // delegated turn never really ran" (a real failure) — so an empty improvements/ dir is
    // diagnosable instead of a silent mystery.
    const details = found > 0
      ? `Found ${found} new ${kind} suggestion(s)`
      : (outcome && outcome.concluded === false)
        ? `Analysis did not complete (${outcome.reason}) — 0 suggestions`
        : `Analysis completed — no ${kind} pattern met the bar`;
    runningScan = { active: false, kind, scope, directory: directory || null, phase: 'done', found, details };
  } catch (error) {
    console.error(`[improvement] runCategoryScan ${kind}/${scope} failed:`, error?.stack || error?.message || error);
    runningScan = { active: false, kind, scope, directory: directory || null, phase: 'done', found: 0, details: `Scan failed: ${error?.message || 'unknown error'}` };
  }
}
