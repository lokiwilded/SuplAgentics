// Moved verbatim from the OpenChamber fork's packages/web/server/lib/suplagentics/opencode-mem-
// client.js. Client for opencode-mem's real local write API. opencode-mem runs a web server on
// :4747 exposing `POST /api/memories` (unauthenticated on localhost), which writes directly into
// its real per-project SQLite shard — the same storage its own search/list/web UI reads from.
//
// The containerTag algorithm below is ported byte-faithfully from opencode-mem's own
// getProjectTagInfo/getProjectIdentity/getProjectRoot — this has to compute the exact same tag
// opencode-mem itself would for a given directory, or imported memories land in a different
// (wrong, orphaned) shard instead of the project's real one.

import crypto from 'node:crypto';
import { execSync as execSyncCp } from 'node:child_process';
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

const OPENCODE_MEM_BASE = 'http://localhost:4747';

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function git(args, cwd) {
  try {
    // windowsHide is required on Windows — without it, execSync flashes a real visible console
    // window for every single invocation. Verified live: a bulk import pushing hundreds of
    // memories (each one calling computeContainerTag -> up to 3 git subprocesses) produced
    // exactly that — hundreds of flashing terminal windows during one import run.
    return execSyncCp(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() || null;
  } catch {
    return null;
  }
}

function getGitCommonDir(directory) {
  const commonDir = git('rev-parse --git-common-dir', directory);
  if (!commonDir) return null;
  const resolved = path.isAbsolute(commonDir) ? path.normalize(commonDir) : path.normalize(path.resolve(directory, commonDir));
  try {
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
  } catch {
    return resolved;
  }
}

function getGitTopLevel(directory) {
  return git('rev-parse --show-toplevel', directory);
}

function getGitRepoUrl(directory) {
  return git('config --get remote.origin.url', directory);
}

function getProjectRoot(directory) {
  const commonDir = getGitCommonDir(directory);
  if (commonDir && path.basename(commonDir) === '.git') return path.dirname(commonDir);
  return getGitTopLevel(directory) || directory;
}

function getProjectIdentity(directory) {
  const commonDir = getGitCommonDir(directory);
  if (commonDir) return `git-common:${commonDir}`;
  const url = getGitRepoUrl(directory);
  if (url) return `remote:${url}`;
  return `path:${path.normalize(directory)}`;
}

function getProjectName(directory) {
  const normalized = path.normalize(directory).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(p => p && p !== '.');
  return parts[parts.length - 1] || directory;
}

// containerTag = `opencode_project_${sha256(getProjectIdentity(getProjectRoot(directory)))}`
// — verified live against `curl http://localhost:4747/api/tags`'s real container tags.
//
// Cached per input directory — a bulk memory push (processMemoryPushQueue) calls this once per
// ROW, and many rows share the same project directory, so without caching this was re-spawning
// up to 3 real git subprocesses per memory instead of per unique project (hundreds of redundant
// spawns during one real bulk import, not just a cosmetic issue — each is genuine process-launch
// overhead on top of the Windows console-flash problem fixed above). A project's git identity
// cannot change mid-process, so caching for the process lifetime is safe.
const containerTagCache = new Map();
export function computeContainerTag(directory) {
  const cached = containerTagCache.get(directory);
  if (cached) return cached;
  const projectRoot = getProjectRoot(directory);
  const result = {
    containerTag: `opencode_project_${sha256(getProjectIdentity(projectRoot))}`,
    projectPath: projectRoot,
    projectName: getProjectName(projectRoot),
  };
  containerTagCache.set(directory, result);
  return result;
}

// Each POST does a real embedding computation server-side (local Ollama bge-m3) — real
// latency, not free/instant. There's no bulk-insert endpoint; callers pace sequential calls.
export async function postMemory({ content, containerTag, tags, type, projectPath, projectName }) {
  const res = await fetch(`${OPENCODE_MEM_BASE}/api/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, containerTag, tags, type, projectPath, projectName }),
  });
  const data = await res.json();
  if (!data.success) return { ok: false, error: data.error || 'opencode-mem rejected the memory' };
  return { ok: true, id: data.data?.id };
}

// Confirmed real route (both web-server.js and web-server-worker.js bind it identically).
// Exposed as an explicit action, not run automatically after every import — a bulk dedup
// pass over the user's real memory store deserves a deliberate click, not a side effect.
export async function runDeduplication() {
  const res = await fetch(`${OPENCODE_MEM_BASE}/api/deduplicate`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) return { ok: false, error: data.error || 'deduplication failed' };
  return { ok: true, result: data.data };
}

// opencode-mem has no delete-by-tag route — verified live against its real compiled source
// (dist/services/web-server.js): only GET /api/memories?tag=, DELETE /api/memories/:id, and
// POST /api/memories/bulk-delete exist. Deleting "everything for a project" means paging through
// every memory for that containerTag first, then bulk-deleting the collected ids — using
// opencode-mem's own sanctioned API throughout, never touching its SQLite shards directly.
export async function deleteMemoriesByContainerTag(containerTag) {
  const ids = [];
  let page = 1;
  const pageSize = 100;
  for (;;) {
    const url = `${OPENCODE_MEM_BASE}/api/memories?tag=${encodeURIComponent(containerTag)}&page=${page}&pageSize=${pageSize}&includePrompts=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error || 'failed to list memories for deletion' };
    const items = Array.isArray(data.data?.items) ? data.data.items : (Array.isArray(data.data) ? data.data : []);
    for (const item of items) if (item?.id) ids.push(item.id);
    if (items.length < pageSize) break;
    page++;
  }
  if (ids.length === 0) return { ok: true, deletedCount: 0 };

  const res = await fetch(`${OPENCODE_MEM_BASE}/api/memories/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, cascade: true }),
  });
  const data = await res.json();
  if (!data.success) return { ok: false, error: data.error || 'bulk delete failed' };
  return { ok: true, deletedCount: ids.length };
}
