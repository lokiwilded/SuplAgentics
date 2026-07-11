// The write path of Import History — actually chunking, redacting, and queuing session/memory
// history for summarization. Moved from the OpenChamber fork's packages/web/server/lib/
// suplagentics/import-routes.js (see the approved MCP server architecture plan, section 2).
//
// `onProjectDiscovered`, where accepted below, is a plain `async (directory) => void` callback —
// deliberately NOT a direct import of the fork's own project-registration.js (that file depends
// on OpenChamber's settings/project system, which has no standalone-MCP-server equivalent and
// shouldn't get one). The fork supplies this callback bound to its own registerProjectIfNew; an
// MCP tool caller with no such concept simply omits it.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  upsertProject, insertMemoryFile, insertPendingChunk, markSessionHandledEmpty,
  hasMemoryFile, hasSessionFile, hasOpencodeSessionImported,
} from './claude-import-db.js';
import { redactSecrets, chunkTexts } from './import-shared.js';
import { openDb } from '../../sqlite-runtime.js';
import { scanProject, findAllSessionFiles, CLAUDE_PROJECTS_DIR, OPENCODE_DB_PATH } from './scan.js';

// Real frontmatter shape confirmed against actual ~/.claude/projects/*/memory/*.md files:
// `name`/`description` at the top level, plus a `metadata:` block with indented sub-keys.
function parseMemoryFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { name: null, description: null, metadata: {}, body: content };
  const lines = m[1].split(/\r?\n/);
  const meta = {};
  let inMetadata = false;
  for (const line of lines) {
    if (/^metadata:\s*$/.test(line)) { inMetadata = true; continue; }
    if (inMetadata) {
      const sub = line.match(/^\s+([a-zA-Z0-9_]+):\s*(.*)$/);
      if (sub) { meta[sub[1]] = sub[2].trim(); continue; }
      inMetadata = false;
    }
    const top = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (top && top[1] !== 'metadata') meta['_' + top[1]] = top[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return {
    name: meta['_name'] || null,
    description: meta['_description'] || null,
    metadata: meta,
    body: m[2],
  };
}

// Real .jsonl transcript lines vary by `type` — only `user`/`assistant` entries carry actual
// conversational content.
function extractConversationalText(jsonlContent) {
  const texts = [];
  for (const line of jsonlContent.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        texts.push(`[${obj.type}] ${block.text.trim()}`);
      }
    }
  }
  return texts;
}

export async function importProject(projectId, onFile) {
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectId);
  const scanned = await scanProject(projectId);
  if (!scanned) return { ok: false, error: 'project not found' };

  await upsertProject(projectId, scanned.path, scanned.name);

  const memoryDir = path.join(projectDir, 'memory');
  let memoryFiles = [];
  try { memoryFiles = readdirSync(memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md'); } catch { /* no memory dir */ }
  let memoryFilesImported = 0;
  for (const f of memoryFiles) {
    const name = f.replace('.md', '');
    if (await hasMemoryFile(projectId, name)) { if (onFile) onFile(); continue; }
    let content;
    try { content = readFileSync(path.join(memoryDir, f), 'utf8'); } catch { if (onFile) onFile(); continue; }
    const { name: fmName, description, metadata, body } = parseMemoryFrontmatter(content);
    await insertMemoryFile(projectId, {
      name: fmName || name,
      description: description ? redactSecrets(description) : description,
      type: metadata.type || null,
      originSessionId: metadata.originSessionId || null,
      content: redactSecrets(body.trim()),
    });
    memoryFilesImported++;
    if (onFile) onFile();
  }

  const sessionFiles = await findAllSessionFiles(projectDir);
  let sessionFilesProcessed = 0;
  for (const f of sessionFiles) {
    if (await hasSessionFile(projectId, f)) { if (onFile) onFile(); continue; }
    let content;
    try { content = readFileSync(path.join(projectDir, f), 'utf8'); } catch { if (onFile) onFile(); continue; }
    const texts = extractConversationalText(content).map(redactSecrets);
    if (texts.length === 0) {
      // Nothing to summarize (a tool-only session, etc.) — still mark it handled, or it stays
      // permanently "not yet imported" and gets silently retried forever (see
      // markSessionHandledEmpty's own comment for the full story).
      await markSessionHandledEmpty(projectId, f, 'claude-code');
      sessionFilesProcessed++;
      if (onFile) onFile();
      continue;
    }
    const chunks = chunkTexts(texts);
    for (let i = 0; i < chunks.length; i++) await insertPendingChunk(projectId, f, i, chunks[i]);
    sessionFilesProcessed++;
    if (onFile) onFile();
  }

  return { ok: true, memoryFilesImported, sessionFilesProcessed };
}

// Real conversational text out of opencode's own SQLite store — only `text` parts carry prose
// worth summarizing.
function extractOpencodeSessionTexts(db, sessionId) {
  const rows = db.all(`
    SELECT p.data, COALESCE(json_extract(m.data,'$.role'), 'assistant') as role
    FROM part p
    LEFT JOIN message m ON m.id = p.message_id
    WHERE p.session_id = ? AND json_extract(p.data,'$.type') = 'text'
    ORDER BY p.time_created ASC
  `, sessionId);
  const texts = [];
  for (const r of rows) {
    let parsed;
    try { parsed = JSON.parse(r.data); } catch { continue; }
    if (typeof parsed.text === 'string' && parsed.text.trim()) texts.push(`[${r.role}] ${parsed.text.trim()}`);
  }
  return texts;
}

// Imports opencode's own tracked session history straight out of opencode.db. Queued under a
// synthetic `opencode:<normalizedDirectory>` bucket so it can't collide with a real Claude Code
// project id, and tagged provider: 'opencode' in the shared pending_chunks queue.
export async function importOpencodeSessions(directories, onProjectDiscovered) {
  if (!existsSync(OPENCODE_DB_PATH)) return { ok: false, error: 'opencode.db not found' };
  const db = await openDb(OPENCODE_DB_PATH, { readonly: true });
  let sessionsProcessed = 0;
  try {
    for (const directory of directories) {
      const normDir = directory.replace(/\\/g, '/').replace(/\/+$/, '');
      const winDir = normDir.replace(/\//g, '\\');
      const opencodeProjectId = `opencode:${normDir}`;
      await upsertProject(opencodeProjectId, directory, path.basename(directory));
      // These directories come straight from opencode.db's own project table — already real,
      // user-confirmed project roots, unlike the Claude Code side's recovered/guessed paths — so
      // no junk filtering is needed before tracking them in OpenChamber's own project list.
      if (onProjectDiscovered) await onProjectDiscovered(directory);
      const sessions = db.all(`
        SELECT s.id FROM session s JOIN project pr ON pr.id = s.project_id
        WHERE (pr.worktree = ? OR pr.worktree = ?) AND s.parent_id IS NULL
      `, normDir, winDir);
      for (const s of sessions) {
        if (await hasOpencodeSessionImported(s.id)) continue;
        const texts = extractOpencodeSessionTexts(db, s.id).map(redactSecrets);
        if (texts.length === 0) {
          // Nothing to summarize — still mark it handled, or it stays permanently "not yet
          // imported" and gets silently retried forever (see markSessionHandledEmpty's comment).
          await markSessionHandledEmpty(opencodeProjectId, s.id, 'opencode');
          sessionsProcessed++;
          continue;
        }
        const chunks = chunkTexts(texts);
        for (let i = 0; i < chunks.length; i++) await insertPendingChunk(opencodeProjectId, s.id, i, chunks[i], 'opencode');
        sessionsProcessed++;
      }
    }
  } finally {
    db.close();
  }
  return { ok: true, sessionsProcessed };
}

export let importProgress = { active: false, current: 0, total: 0 };

// Batch-imports every given Claude Code project id, tracking overall progress (readable via the
// live-bound `importProgress` export above) so a caller can show a "reading files… (N/M)"
// indicator across the whole batch, not just per project.
export async function runImportBatch(projectIds, onProjectDiscovered) {
  if (importProgress.active) return;
  const scans = new Map();
  for (const id of projectIds) { scans.set(id, await scanProject(id)); }
  const total = projectIds.reduce((sum, id) => {
    const scanned = scans.get(id);
    return sum + (scanned ? scanned.memoryFileCount + scanned.sessionFileCount : 0);
  }, 0);
  importProgress = { active: true, current: 0, total };

  const results = [];
  for (const id of projectIds) {
    results.push(await importProject(id, () => { importProgress.current++; }));
  }

  // Surface newly-imported history in OpenChamber's own project list (sidebar, project
  // selectors everywhere) — but only for a real, recovered directory that doesn't look like junk
  // (a ccprobe healthcheck or other ephemeral probe has no real project to add). `scanned.path`
  // falls back to the raw Claude Code project-id string when recovery fails, so `path !== id` is
  // the signal a real directory was actually found.
  if (onProjectDiscovered) {
    for (const id of projectIds) {
      const scanned = scans.get(id);
      if (scanned && scanned.path !== id && !scanned.likelyJunk) {
        await onProjectDiscovered(scanned.path);
      }
    }
  }

  importProgress = { active: false, current: 0, total: 0 };
  return results;
}
