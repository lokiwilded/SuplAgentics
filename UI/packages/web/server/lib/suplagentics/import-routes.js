// SuplAgentics's history-import port. Scans two sources tied back to the real projects they came
// from:
//   - opencode's own session history, straight out of the shared opencode.db (every project
//     opencode.db knows about, not just ones some separate tracking file happens to list — see
//     CLAUDE.md's "Project launch model": one opencode.db is the single source of truth here).
//   - Claude Code's local ~/.claude/projects/ (only that directory is ever read — .credentials.json
//     and .claude.json, which carry oauthAccount/mcpServers/machineID, are never touched).
// Opt-in per project — nothing imports until the user picks a project and clicks Import.
//
// The real capability logic (scanning, redaction/chunking, the ephemeral queue, summarizer/push
// batching) now lives in the standalone suplagentics-mcp-server package (see the approved MCP
// server architecture plan) — this file is the Express adapter plus the pieces that are
// genuinely dashboard-specific and stay here on purpose:
//   - The "isNew"/ignore-list tracking files (suplagentics-import-seen.json,
//     suplagentics-import-ignored.json) — UI bookkeeping for this dashboard's own Import History
//     page, not a capability any other MCP client would need.
//   - project-registration.js's registerProjectIfNew, which depends on OpenChamber's own
//     settings/project system — no standalone-MCP-server equivalent exists or should exist for
//     "add this to OpenChamber's own sidebar." It's supplied to the moved capability functions as
//     a plain callback, never imported by them directly.

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeContainerTag, runDeduplication, deleteMemoriesByContainerTag } from 'suplagentics-mcp-server/src/capabilities/import/opencode-mem-client.js';
import { deleteProjectData, status as dbStatus } from 'suplagentics-mcp-server/src/capabilities/import/claude-import-db.js';
import { scanClaudeProjects, opencodeScan, CLAUDE_PROJECTS_DIR } from 'suplagentics-mcp-server/src/capabilities/import/scan.js';
import { getMemoryStoreStats } from 'suplagentics-mcp-server/src/capabilities/import/mem-stats.js';
import { importOpencodeSessions, runImportBatch, importProgress } from 'suplagentics-mcp-server/src/capabilities/import/import.js';
import { spawnSummarizerBatch, processMemoryPushQueue, summarizing, pushing, indexerState, clearIndexerStall } from 'suplagentics-mcp-server/src/capabilities/import/summarize.js';
import { registerProjectIfNew } from './project-registration.js';
import { enforceSameOrigin } from './api-security.js';

// Tracks which Claude Code / opencode projects (and their session/memory counts) have already
// been shown on the Import page, so a genuinely new project or new sessions/memories appearing in
// an already-seen project can be flagged "NEW" instead of silently blending in.
const SEEN_PATH = path.join(os.homedir(), '.config', 'opencode', 'suplagentics-import-seen.json');

function readSeen() {
  try { if (existsSync(SEEN_PATH)) return JSON.parse(readFileSync(SEEN_PATH, 'utf8')); } catch { /* first run */ }
  return { lastCheckedAt: 0, claude: {}, opencode: {} };
}

function writeSeen(data) {
  mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(data, null, 2));
}

// One-time-only tracking for the retroactive sidebar backfill below — separate from IGNORED
// (an explicit user opt-out) and from SEEN (isNew/badge tracking, which legitimately needs to
// re-fire on new activity). This one needs the opposite property: fire at most ONCE per project,
// ever, regardless of future activity. Verified live this was missing: without it, re-registering
// on every single GET /scan call (which fires on every Import page load) silently reverted a
// user's own manual removal of that project from OpenChamber's sidebar moments later — the
// backfill has no way to distinguish "never seen this project" from "user just removed it on
// purpose" unless something records that the backfill already ran for it.
const BACKFILLED_PATH = path.join(os.homedir(), '.config', 'opencode', 'suplagentics-import-backfilled.json');

function readBackfilled() {
  try { if (existsSync(BACKFILLED_PATH)) return JSON.parse(readFileSync(BACKFILLED_PATH, 'utf8')); } catch { /* first run */ }
  return { claudeIds: [], directories: [] };
}

function writeBackfilled(data) {
  mkdirSync(path.dirname(BACKFILLED_PATH), { recursive: true });
  writeFileSync(BACKFILLED_PATH, JSON.stringify(data, null, 2));
}

// Explicit user opt-out — a project the user never wants cluttering this page again. Deliberately
// permanent (survives new session activity, unlike the isNew/"seen" tracking above) — the whole
// point is to stop re-surfacing something the user has decided not to import, not to just
// silently reset the moment they start a fresh chat there. Only reversible by the user manually
// re-adding the project through some other real action (e.g. opencode itself picking it up as a
// project again) — this file has no "un-ignore" affordance on its own by design.
const IGNORED_PATH = path.join(os.homedir(), '.config', 'opencode', 'suplagentics-import-ignored.json');

function readIgnored() {
  try { if (existsSync(IGNORED_PATH)) return JSON.parse(readFileSync(IGNORED_PATH, 'utf8')); } catch { /* first run */ }
  return { claudeIds: [], directories: [] };
}

function writeIgnored(data) {
  mkdirSync(path.dirname(IGNORED_PATH), { recursive: true });
  writeFileSync(IGNORED_PATH, JSON.stringify(data, null, 2));
}

function normalizeDirForIgnore(directory) {
  return (directory || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// A Claude Code project can be excluded either by its own opaque scanner id (works even when
// path recovery failed) or by its recovered real directory (so ignoring it via one source also
// hides the same real project when it shows up on the OTHER source's list) — checked against both.
function isIgnored(ignored, { claudeId, directory }) {
  if (claudeId && ignored.claudeIds.includes(claudeId)) return true;
  if (directory && ignored.directories.includes(normalizeDirForIgnore(directory))) return true;
  return false;
}

export function registerSuplagenticsImportRoutes(app, { buildOpenCodeUrl, getOpenCodeAuthHeaders, readSettingsFromDiskMigrated, persistSettings, sanitizeProjects, createProjectIdFromPath }) {
  const opencodeDeps = { buildOpenCodeUrl, getOpenCodeAuthHeaders };
  const projectRegistrationDeps = { readSettingsFromDiskMigrated, persistSettings, sanitizeProjects, createProjectIdFromPath };
  const onProjectDiscovered = readSettingsFromDiskMigrated
    ? (directory) => registerProjectIfNew(directory, projectRegistrationDeps)
    : null;

  app.get('/api/suplagentics/import/scan', async (req, res) => {
    try {
      const seen = readSeen();
      const ignored = readIgnored();

      const claudeProjects = (await scanClaudeProjects())
        .filter((p) => !isIgnored(ignored, { claudeId: p.id, directory: p.path !== p.id ? p.path : null }))
        // Nothing importable there (no sessions, no memories) — clutters the list for no reason.
        .filter((p) => p.sessionFileCount > 0 || p.memoryFileCount > 0)
        .map(p => {
          const prev = seen.claude[p.id];
          return { ...p, isNew: !prev || p.sessionFileCount > prev.sessionFileCount || p.memoryFileCount > prev.memoryFileCount };
        });
      const opencodeProjects = (await opencodeScan())
        .filter((p) => !isIgnored(ignored, { directory: p.directory }))
        .filter((p) => p.sessionCount > 0);

      // Retroactive backfill: a project fully imported before project-auto-registration existed
      // (or from a run whose registration attempt failed) has no active Import button left to
      // re-trigger it — self-heals the next time this page is opened. Fires AT MOST ONCE per
      // project, ever — verified live this was previously re-firing on every single scan
      // (every Import page load), which silently re-added a project to OpenChamber's sidebar
      // moments after the user deliberately removed it there. Once a project has been through
      // this backfill (successfully or not), it's the user's call from then on whether it stays
      // in the sidebar — this isn't a "keep the sidebar in sync with Import" feature.
      if (onProjectDiscovered) {
        const backfilled = readBackfilled();
        let backfilledChanged = false;
        for (const p of claudeProjects) {
          if (p.fullyImported && !p.likelyJunk && !backfilled.claudeIds.includes(p.id)) {
            await onProjectDiscovered(p.path);
            backfilled.claudeIds.push(p.id);
            backfilledChanged = true;
          }
        }
        for (const p of opencodeProjects) {
          const key = normalizeDirForIgnore(p.directory);
          if (p.fullyImported && !backfilled.directories.includes(key)) {
            await onProjectDiscovered(p.directory);
            backfilled.directories.push(key);
            backfilledChanged = true;
          }
        }
        if (backfilledChanged) writeBackfilled(backfilled);
      }

      // Durable memory-store totals (opencode-mem's real store, all sources) for the page
      // headline — distinct from the import queue's own throughput counters in /status.
      const memStore = await getMemoryStoreStats();

      res.set('Cache-Control', 'no-store');
      res.json({
        claude: { available: existsSync(CLAUDE_PROJECTS_DIR), projects: claudeProjects },
        opencode: { projects: opencodeProjects },
        memStore,
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/suplagentics/import/status', async (req, res) => {
    try {
      const s = await dbStatus();
      // Resume-on-view safety net: if the server process restarted mid-import (losing the
      // in-memory summarizing/pushing state), a real backlog with nothing running gets picked
      // back up here rather than staying stuck forever. A stalled queue (a batch turn completed
      // with zero progress — see indexerState in the MCP server package) is deliberately NOT
      // auto-resumed here: that's exactly the loop that used to re-spawn a session every ~40s
      // against the same unprocessable chunk. Stalled queues resume only via an explicit user
      // action (the Indexing page's Retry, or a fresh import run).
      if (s.chunksPending > 0 && !summarizing && !indexerState.stalled) spawnSummarizerBatch(opencodeDeps);
      if (s.memoryFilesPushPending > 0 && pushing.size === 0) processMemoryPushQueue();
      res.set('Cache-Control', 'no-store');
      res.json({
        ...s, summarizing, pushing: pushing.size > 0,
        stalled: indexerState.stalled, stalledPending: indexerState.stalledPending,
        importing: importProgress.active, importCurrent: importProgress.current, importTotal: importProgress.total,
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/suplagentics/import/run', enforceSameOrigin, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const { source, projectIds, directories } = req.body || {};
      if (source === 'claude-code') {
        const ids = Array.isArray(projectIds) ? projectIds : [];
        if (ids.length === 0) {
          res.status(400).json({ error: 'projectIds required' });
          return;
        }
        if (importProgress.active) {
          res.status(409).json({ error: 'an import is already running' });
          return;
        }
        runImportBatch(ids, onProjectDiscovered).then(() => {
          dbStatus().then(s => {
            // A fresh, explicit import run always gets a chance to summarize — including
            // retrying chunks a previous run stalled on.
            clearIndexerStall();
            if (s.chunksPending > 0) spawnSummarizerBatch(opencodeDeps);
            if (s.memoryFilesPushPending > 0) processMemoryPushQueue();
          });
        });
        res.json({ ok: true, started: true });
        return;
      }
      if (source === 'opencode') {
        const dirs = Array.isArray(directories) ? directories : [];
        if (dirs.length === 0) {
          res.status(400).json({ error: 'directories required' });
          return;
        }
        const result = await importOpencodeSessions(dirs, onProjectDiscovered);
        if (result.ok) {
          const s = await dbStatus();
          clearIndexerStall();
          if (s.chunksPending > 0) spawnSummarizerBatch(opencodeDeps);
          if (s.memoryFilesPushPending > 0) processMemoryPushQueue();
        }
        res.status(result.ok ? 200 : 400).json(result);
        return;
      }
      res.status(400).json({ error: 'source must be "claude-code" or "opencode"' });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/suplagentics/import/mark-seen', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const seen = readSeen();
      for (const c of (Array.isArray(req.body?.claude) ? req.body.claude : [])) {
        seen.claude[c.id] = { sessionFileCount: c.sessionFileCount, memoryFileCount: c.memoryFileCount };
      }
      for (const o of (Array.isArray(req.body?.opencode) ? req.body.opencode : [])) {
        seen.opencode[o.key] = { sessionCount: o.sessionCount };
      }
      seen.lastCheckedAt = Date.now();
      writeSeen(seen);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  // Ignore a project — permanently excludes it from future scans (see readIgnored's own comment
  // for why this is deliberately not tied to session-activity resets), with an opt-in "also
  // delete" pass covering everything SuplAgentics itself put somewhere on this project's behalf:
  // the ephemeral import queue's own rows, the real memories already pushed into opencode-mem for
  // this project, and any improvement suggestion .md files written into the project's own
  // improvements/ directory. Never touches the user's own project files, and never touches
  // anything under the GLOBAL improvements directory (that's cross-project by definition, not
  // owned by any single project being ignored here).
  app.post('/api/suplagentics/import/ignore', enforceSameOrigin, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const { source, claudeId, directory, deleteData } = req.body || {};
      if (source !== 'claude-code' && source !== 'opencode') {
        res.status(400).json({ error: 'source must be "claude-code" or "opencode"' });
        return;
      }
      if (source === 'claude-code' && !claudeId) {
        res.status(400).json({ error: 'claudeId required for claude-code source' });
        return;
      }
      if (source === 'opencode' && !directory) {
        res.status(400).json({ error: 'directory required for opencode source' });
        return;
      }

      const ignored = readIgnored();
      if (source === 'claude-code' && !ignored.claudeIds.includes(claudeId)) ignored.claudeIds.push(claudeId);
      const normDir = directory ? normalizeDirForIgnore(directory) : null;
      if (normDir && !ignored.directories.includes(normDir)) ignored.directories.push(normDir);
      writeIgnored(ignored);

      let deletedMemories = 0;
      let deletedSuggestions = false;
      if (deleteData) {
        const projectIds = [];
        if (source === 'claude-code' && claudeId) projectIds.push(claudeId);
        if (directory) projectIds.push(`opencode:${directory.replace(/\\/g, '/').replace(/\/+$/, '')}`);
        for (const pid of projectIds) await deleteProjectData(pid);

        if (directory) {
          const { containerTag } = computeContainerTag(directory);
          const memResult = await deleteMemoriesByContainerTag(containerTag);
          if (memResult.ok) deletedMemories = memResult.deletedCount;

          const improvementsDir = path.join(directory, 'improvements');
          if (existsSync(improvementsDir)) {
            rmSync(improvementsDir, { recursive: true, force: true });
            deletedSuggestions = true;
          }
        }
      }

      res.json({ ok: true, deletedMemories, deletedSuggestions });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/suplagentics/import/deduplicate', enforceSameOrigin, async (req, res) => {
    try {
      const result = await runDeduplication();
      res.status(result.ok ? 200 : 500).json(result);
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });
}
