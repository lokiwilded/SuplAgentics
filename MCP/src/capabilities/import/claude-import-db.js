// Moved verbatim from the OpenChamber fork's packages/web/server/lib/suplagentics/claude-import-
// db.js (see plans/openchamber-fork-port.md and the approved MCP server architecture plan,
// section 2) — the fork's own import-routes.js now imports this from here instead of a local
// sibling file, via the @suplagentics/mcp-server file: dependency.
//
// An ephemeral processing queue for imported provider history (opencode + Claude Code for now) —
// NOT a second permanent memory store. opencode-mem's own real local write API
// (see ./opencode-mem-client.js) is the one real destination; this DB just holds raw chunks
// awaiting summarization and tracks which already-imported memory files have been pushed
// through, so re-running import/push is idempotent.
//
// Same on-disk file as the old SuplAgentics stack (~/.local/share/opencode/suplagentics-claude-
// import.db) — intentional, so history imported from either stack lands in the same queue and
// nothing gets double-imported just because the triggering server changed.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../sqlite-runtime.js';

const DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'suplagentics-claude-import.db');

function migrate(db) {
  const memoryFilesCols = db.all('PRAGMA table_info(memory_files)').map(c => c.name);
  if (!memoryFilesCols.includes('pushed_at')) {
    db.exec('ALTER TABLE memory_files ADD COLUMN pushed_at INTEGER');
  }
  const pendingChunksCols = db.all('PRAGMA table_info(pending_chunks)').map(c => c.name);
  if (!pendingChunksCols.includes('provider')) {
    db.exec("ALTER TABLE pending_chunks ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude-code'");
  }
}

let _db = null;
async function getDb() {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = await openDb(DB_PATH, { readonly: false });
  _db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT,
      origin_session_id TEXT,
      content TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_files_project ON memory_files(project_id);
    CREATE TABLE IF NOT EXISTS pending_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      session_file TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      raw_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_pending_chunks_status ON pending_chunks(status);
  `);
  migrate(_db);
  return _db;
}

// Graceful shutdown — checkpoint the WAL and release the file handle
export async function closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* already closed or never opened */ }
    _db = null;
  }
}
export async function upsertProject(id, projectPath, name) {
  const db = await getDb();
  db.run(`
    INSERT INTO projects (id, path, name, imported_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET path = excluded.path, name = excluded.name
  `, id, projectPath, name, Date.now());
}

export async function insertMemoryFile(projectId, { name, description, type, originSessionId, content }) {
  const db = await getDb();
  db.run(`
    INSERT INTO memory_files (project_id, name, description, type, origin_session_id, content, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, projectId, name, description || null, type || null, originSessionId || null, content, Date.now());
}

// Re-running import on an already-imported project (e.g. to pick up newly-included subagent
// transcripts) would otherwise re-insert duplicate rows for files already processed in a prior
// run — these let importProject skip anything it's already seen, so re-import is idempotent per
// file rather than per whole project.
export async function hasMemoryFile(projectId, name) {
  const db = await getDb();
  return !!db.get('SELECT 1 FROM memory_files WHERE project_id = ? AND name = ? LIMIT 1', projectId, name);
}

export async function hasSessionFile(projectId, sessionFile) {
  const db = await getDb();
  return !!db.get('SELECT 1 FROM pending_chunks WHERE project_id = ? AND session_file = ? LIMIT 1', projectId, sessionFile);
}

// opencode session ids (e.g. "ses_...") are globally unique across the whole opencode.db
// (verified live — zero duplicates across 238 real sessions), unlike Claude Code's per-project
// .jsonl filenames which could collide by name across different projects. The old SuplAgentics
// stack keyed opencode imports as `opencode:<suplagentics-project-uuid>`; this fork has no
// equivalent tracking file and keys them as `opencode:<normalized-directory>` instead — a
// different project_id scheme for the same underlying sessions. Checking by session_file alone
// (no project_id scoping) means a session already imported under the old key scheme is still
// correctly recognized as "already imported" here, instead of getting reprocessed/duplicated.
export async function hasOpencodeSessionImported(sessionId) {
  const db = await getDb();
  return !!db.get("SELECT 1 FROM pending_chunks WHERE provider = 'opencode' AND session_file = ? LIMIT 1", sessionId);
}

export async function insertPendingChunk(projectId, sessionFile, chunkIndex, rawContent, provider = 'claude-code') {
  const db = await getDb();
  db.run(`
    INSERT INTO pending_chunks (project_id, session_file, chunk_index, raw_content, status, provider)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `, projectId, sessionFile, chunkIndex, rawContent, provider);
}

// A session/file with zero extractable conversational text (tool-only sessions, empty
// transcripts, etc.) previously got no row at all here — hasSessionFile/hasOpencodeSessionImported
// check for ANY row with this (project_id, session_file), so with nothing ever inserted, such a
// session was permanently invisible to the "already imported" check and got silently re-attempted
// (and silently skipped) on every future Import click, forever. That's also why the per-project
// N/M imported count could never reach M — verified live against a real project (5 of 8 sessions
// stuck this way indefinitely). Inserting a real 'done' row (nothing to summarize, so no
// pending-then-summarized step needed) marks it handled once and for all.
export async function markSessionHandledEmpty(projectId, sessionFile, provider = 'claude-code') {
  const db = await getDb();
  db.run(`
    INSERT INTO pending_chunks (project_id, session_file, chunk_index, raw_content, status, provider)
    VALUES (?, ?, 0, '', 'done', ?)
  `, projectId, sessionFile, provider);
}

export async function status() {
  const db = await getDb();
  const memoryFilesImported = db.get('SELECT COUNT(*) as c FROM memory_files').c;
  const memoryFilesPushed = db.get('SELECT COUNT(*) as c FROM memory_files WHERE pushed_at IS NOT NULL').c;
  const chunksPending = db.get("SELECT COUNT(*) as c FROM pending_chunks WHERE status = 'pending'").c;
  const chunksDone = db.get("SELECT COUNT(*) as c FROM pending_chunks WHERE status = 'done'").c;
  const projectCount = db.get('SELECT COUNT(*) as c FROM projects').c;
  return {
    imported: projectCount > 0, memoryFilesImported, chunksPending, chunksDone,
    memoryFilesPushed, memoryFilesPushPending: memoryFilesImported - memoryFilesPushed,
  };
}

// Push-queue for writing already-imported memory_files rows into opencode-mem's real API
// (see ./opencode-mem-client.js) — separate from the pending_chunks summarization queue, since
// memory files need no LLM pass, just a redact-then-post.
export async function getUnpushedMemoryFiles(limit) {
  const db = await getDb();
  return db.all('SELECT * FROM memory_files WHERE pushed_at IS NULL ORDER BY id LIMIT ?', limit);
}

export async function markMemoryFilePushed(id) {
  const db = await getDb();
  db.run('UPDATE memory_files SET pushed_at = ? WHERE id = ?', Date.now(), id);
}

export async function getProjectPath(projectId) {
  const db = await getDb();
  return db.get('SELECT path FROM projects WHERE id = ?', projectId)?.path || null;
}

// Bulk fetches for the scan endpoint's "already imported" state — one query each covering every
// project, instead of a query per session/file per project (which would be N+1 against a live
// scan run on every Settings page load).
export async function getImportedOpencodeSessionIds() {
  const db = await getDb();
  return new Set(db.all("SELECT DISTINCT session_file FROM pending_chunks WHERE provider = 'opencode'").map(r => r.session_file));
}

export async function getImportedClaudeSessionFilesByProject() {
  const db = await getDb();
  const rows = db.all("SELECT project_id, session_file FROM pending_chunks WHERE provider = 'claude-code'");
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.project_id)) map.set(r.project_id, new Set());
    map.get(r.project_id).add(r.session_file);
  }
  return map;
}

export async function getImportedMemoryNamesByProject() {
  const db = await getDb();
  const rows = db.all('SELECT project_id, name FROM memory_files');
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.project_id)) map.set(r.project_id, new Set());
    map.get(r.project_id).add(r.name);
  }
  return map;
}

// Wipes this ephemeral queue's own rows for a project — the "ignore + also delete" path on the
// Import page. Deliberately deletes from all three tables regardless of provider, since a real
// Claude Code project id and its synthetic `opencode:<dir>` counterpart are two DIFFERENT
// project_id values for what the user thinks of as "the same project" — callers should pass
// every project_id that applies (both, if both exist) rather than expecting this to fan out.
export async function deleteProjectData(projectId) {
  const db = await getDb();
  db.run('DELETE FROM pending_chunks WHERE project_id = ?', projectId);
  db.run('DELETE FROM memory_files WHERE project_id = ?', projectId);
  db.run('DELETE FROM projects WHERE id = ?', projectId);
}

export { DB_PATH };
