// Pure data-access half of Import History — filesystem + SQLite only, no live opencode session
// dependency. Moved from the OpenChamber fork's packages/web/server/lib/suplagentics/import-
// routes.js (see the approved MCP server architecture plan, section 2) — the fork's own
// import-routes.js now imports scanClaudeProjects/opencodeScan from here instead of defining them
// locally. Deliberately excludes the dashboard-specific "isNew"/ignore-list concepts from the
// fork's own route handler — those are UI/settings-persistence concerns, not core scan data, and
// stay in the fork.

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../sqlite-runtime.js';
import {
  getImportedOpencodeSessionIds,
  getImportedClaudeSessionFilesByProject,
  getImportedMemoryNamesByProject,
} from './claude-import-db.js';

export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
export const OPENCODE_DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

function looksLikeJunk(realPath) {
  if (!realPath) return true;
  return /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i.test(realPath) || /ccprobe/i.test(realPath);
}

async function recoverRealPath(projectDir) {
  let files;
  try { files = (await readdir(projectDir)).filter(f => f.endsWith('.jsonl')); } catch { return null; }
  for (const f of files) {
    let content;
    try { content = await readFile(path.join(projectDir, f), 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    for (const line of lines.slice(0, 20)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
      } catch { /* not JSON */ }
    }
  }
  return null;
}

export async function findAllSessionFiles(projectDir) {
  const files = [];
  let entries;
  try { entries = await readdir(projectDir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      files.push(e.name);
    } else if (e.isDirectory()) {
      const subagentsDir = path.join(projectDir, e.name, 'subagents');
      let subFiles = [];
      try { subFiles = (await readdir(subagentsDir)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of subFiles) files.push(path.join(e.name, 'subagents', f));
    }
  }
  return files;
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(full);
    else { try { total += (await stat(full)).size; } catch { /* race with deletion */ } }
  }
  return total;
}

export async function scanProject(name, importedSessionFilesByProject, importedMemoryNamesByProject) {
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, name);
  let entries;
  try { entries = readdirSync(projectDir, { withFileTypes: true }); } catch { return null; }
  void entries;

  const sessionFiles = await findAllSessionFiles(projectDir);
  const memoryDir = path.join(projectDir, 'memory');
  let memoryFiles = [];
  try { memoryFiles = (await readdir(memoryDir)).filter(f => f.endsWith('.md') && f !== 'MEMORY.md'); } catch { /* no memory dir */ }

  const realPath = await recoverRealPath(projectDir);
  const totalBytes = await dirSize(projectDir);

  const importedSessionFiles = importedSessionFilesByProject?.get(name) ?? new Set();
  const importedMemoryNames = importedMemoryNamesByProject?.get(name) ?? new Set();
  const importedSessionFileCount = sessionFiles.filter((f) => importedSessionFiles.has(f)).length;
  const importedMemoryFileCount = memoryFiles.filter((f) => importedMemoryNames.has(f.replace('.md', ''))).length;
  const totalItems = sessionFiles.length + memoryFiles.length;
  const importedItems = importedSessionFileCount + importedMemoryFileCount;

  return {
    id: name,
    path: realPath || name,
    name: realPath ? path.basename(realPath) : name,
    memoryFileCount: memoryFiles.length,
    sessionFileCount: sessionFiles.length,
    importedSessionFileCount,
    importedMemoryFileCount,
    fullyImported: totalItems > 0 && importedItems === totalItems,
    totalBytes,
    likelyJunk: looksLikeJunk(realPath) || (sessionFiles.length === 0 && memoryFiles.length === 0),
  };
}

export async function scanClaudeProjects() {
  let dirNames;
  try { dirNames = (await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
  const [importedSessionFilesByProject, importedMemoryNamesByProject] = await Promise.all([
    getImportedClaudeSessionFilesByProject(),
    getImportedMemoryNamesByProject(),
  ]);
  return dirNames
    = await Promise.all(
    dirNames.map((name) => scanProject(name, importedSessionFilesByProject, importedMemoryNamesByProject))
  )
    .filter(Boolean)
    .filter((p) => !p.likelyJunk)
    .filter((p) => p.sessionFileCount > 0 || p.memoryFileCount > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes);
}

export async function opencodeScan() {
  if (!existsSync(OPENCODE_DB_PATH)) return [];
  const db = await openDb(OPENCODE_DB_PATH, { readonly: true });
  const out = [];
  try {
    const importedSessionIds = await getImportedOpencodeSessionIds();
    const rows = db.all("SELECT id, worktree, name FROM project WHERE id != 'global'");
    const seenDirs = new Set();
    for (const row of rows) {
      if (!row.worktree || seenDirs.has(row.worktree)) continue;
      seenDirs.add(row.worktree);
      const normDir = row.worktree.replace(/\\/g, '/').replace(/\/+$/, '');
      const winDir = normDir.replace(/\//g, '\\');
      const sessionRows = db.all(`
        SELECT s.id FROM session s JOIN project pr ON pr.id = s.project_id
        WHERE (pr.worktree = ? OR pr.worktree = ?) AND s.parent_id IS NULL
      `, normDir, winDir);
      const sessionCount = sessionRows.length;
      const importedCount = sessionRows.filter((s) => importedSessionIds.has(s.id)).length;
      if (sessionCount === 0) continue;
      out.push({
        key: normDir,
        directory: row.worktree,
        importedCount,
        fullyImported: importedCount === sessionCount,
        name: row.name || path.basename(row.worktree),
        sessionCount,
      });
    }
  } catch {
    // opencode.db schema unexpected/missing table — treat as "nothing discoverable" rather than throwing
  } finally {
    db.close();
  }
  return out;
}
