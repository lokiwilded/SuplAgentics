import { z } from 'zod';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, relative, resolve } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { openDb } from '../sqlite-runtime.js';

// Semantic code-search tools, ported from the opencode plugin ./plugin/suplagentics-rag.ts into
// this MCP server so the whole RAG capability lives in one place (see plans/openchamber-fork-port.md).
// Runtime difference vs the plugin: the plugin ran under Bun and used bun:sqlite directly; this
// server is launched as plain `node`, so it goes through sqlite-runtime.js (better-sqlite3 under
// node, bun:sqlite under bun) — same normalized all/get/run/exec/close shape either way.

const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.SUPLAGENTICS_EMBED_MODEL || 'bge-m3';
const DB_PATH     = join(homedir(), '.local', 'share', 'opencode', 'suplagentics-rag.db');
const SETTINGS_PATH = join(homedir(), '.config', 'opencode', 'suplagentics-settings.json');

function loadSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {}
  return {};
}
const _S = loadSettings();

const CHUNK_LINES    = _S.rag_chunk_lines  ?? 50;
const CHUNK_OVERLAP  = Math.floor(CHUNK_LINES / 5);
const MAX_FILE_BYTES = (_S.rag_max_file_kb ?? 100) * 1024;

const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.rb', '.php', '.swift', '.kt',
  '.vue', '.svelte', '.astro',
  '.liquid', '.md', '.mdx',
  '.json', '.yaml', '.yml', '.toml',
  '.sh', '.bash', '.zsh',
  '.css', '.scss', '.html', '.sql',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', 'vendor', 'target', 'out',
]);

async function initDB() {
  mkdirSync(join(homedir(), '.local', 'share', 'opencode'), { recursive: true });
  const db = await openDb(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      content TEXT NOT NULL,
      embedding BLOB,
      file_mtime INTEGER,
      indexed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ws ON chunks(workspace);
    CREATE TABLE IF NOT EXISTS workspaces (
      path TEXT PRIMARY KEY,
      indexed_at INTEGER,
      chunk_count INTEGER
    );
  `);
  return db;
}

function cosine(a, b) {
  if (a.length !== b.length) return -1; /* dimension mismatch — skip */
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function embed(text) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const { embedding } = await res.json();
    return new Float32Array(embedding);
  } catch { return null; }
}
function vecToBlob(v) { return Buffer.from(v.buffer, v.byteOffset, v.byteLength); }
function blobToVec(b) {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  /* Copy to an aligned buffer — avoids RangeError on pooled/sliced Buffers with non-4-aligned
     byteOffset (better-sqlite3 normally returns standalone buffers, but cheap insurance). */
  const copy = Buffer.alloc(buf.length);
  buf.copy(copy);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function chunkContent(content, filePath) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES - CHUNK_OVERLAP) {
    const s = i, e = Math.min(i + CHUNK_LINES, lines.length);
    out.push({ text: `// ${filePath} lines ${s + 1}-${e}\n` + lines.slice(s, e).join('\n'), startLine: s + 1, endLine: e });
    if (e >= lines.length) break;
  }
  return out;
}

async function walkDir(dir) {
  const files = [];
  async function walk(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(join(d, e.name));
      } else if (e.isFile() && CODE_EXTS.has(extname(e.name).toLowerCase())) {
        files.push(join(d, e.name));
      }
    }
  }
  await walk(dir);
  return files;
}

// --- Staleness detection & incremental re-index (P0-2 fix) ---

/** Check if a file's chunks are stale (mtime changed or file deleted). */
async function isFileStale(db, dir, relPath) {
  const row = db.get('SELECT file_mtime FROM chunks WHERE workspace = ? AND file_path = ? LIMIT 1', dir, relPath);
  if (!row || row.file_mtime == null) return true;
  try {
    const info = await stat(join(dir, relPath));
    return info.mtimeMs !== row.file_mtime;
  } catch {
    return true; // file deleted or unreadable
  }
}

/** Re-index a single file within a workspace. Returns true if re-indexed, false if skipped/deleted. */
async function reindexFile(db, dir, relPath) {
  const fullPath = join(dir, relPath);
  // Always remove old chunks first (handles content shrink / file deletion)
  db.run('DELETE FROM chunks WHERE workspace = ? AND file_path = ?', dir, relPath);
  try {
    const info = await stat(fullPath);
    if (info.size > MAX_FILE_BYTES) return false;
    const content = await readFile(fullPath, 'utf8');
    for (const chunk of chunkContent(content, relPath)) {
      const vec = await embed(chunk.text);
      if (!vec) continue; // embed failure during query-time reindex; chunk skipped
      db.run(
        'INSERT INTO chunks (workspace,file_path,start_line,end_line,content,embedding,file_mtime,indexed_at) VALUES (?,?,?,?,?,?,?,?)',
        dir, relPath, chunk.startLine, chunk.endLine, chunk.text, vecToBlob(vec), info.mtimeMs, Date.now(),
      );
    }
    return true;
  } catch {
    return false; // file deleted or unreadable — chunks already deleted above
  }
}

const asText = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });

export function registerRagTools(server) {
  server.registerTool(
    'suplagentics_index_workspace',
    {
      title: 'Index a workspace for semantic search',
      description:
        'Index a project directory for semantic code search using local bge-m3 embeddings via Ollama. ' +
        'Run once at the start of a session in a new project. Skips if already indexed recently. ' +
        'Requires Ollama running locally with the embed model pulled.',
      inputSchema: {
        directory: z.string().describe('Absolute path to the project root to index'),
        force: z.boolean().default(false).describe('Re-index even if already indexed'),
      },
    },
    async ({ directory, force }) => {
      const dir = resolve(directory);
      try { await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }); }
      catch { return asText(`Ollama not reachable at ${OLLAMA_URL}. Run: ollama serve`); }

      const testVec = await embed('hello');
      if (!testVec) return asText(`Model '${EMBED_MODEL}' not available. Run: ollama pull ${EMBED_MODEL}`);

      const db = await initDB();
      try {
        if (!force) {
          const ws = db.get('SELECT chunk_count, indexed_at FROM workspaces WHERE path = ?', dir);
          if (ws) {
            const ageMins = Math.round((Date.now() - ws.indexed_at) / 60000);
            return asText(`Already indexed: ${ws.chunk_count} chunks, ${ageMins}m ago. Pass force:true to re-index.`);
          }
        }

        db.run('DELETE FROM chunks WHERE workspace = ?', dir);
        const files = await walkDir(dir);
        let indexed = 0, skipped = 0, embedFailed = 0, totalChunks = 0;
        for (const file of files) {
          try {
            const info = await stat(file);
            if (info.size > MAX_FILE_BYTES) { skipped++; continue; }
            const content = await readFile(file, 'utf8');
            const relPath = relative(dir, file);
            for (const chunk of chunkContent(content, relPath)) {
              const vec = await embed(chunk.text);
              if (!vec) { embedFailed++; continue; }
              db.run(
                'INSERT INTO chunks (workspace,file_path,start_line,end_line,content,embedding,file_mtime,indexed_at) VALUES (?,?,?,?,?,?,?,?)',
                dir, relPath, chunk.startLine, chunk.endLine, chunk.text, vecToBlob(vec), info.mtimeMs, Date.now(),
              );
              totalChunks++;
            }
            indexed++;
          } catch { skipped++; }
        }
        db.run('INSERT OR REPLACE INTO workspaces (path,indexed_at,chunk_count) VALUES (?,?,?)', dir, Date.now(), totalChunks);
        return asText(`Indexed ${indexed} files → ${totalChunks} chunks (${skipped} skipped${embedFailed ? `, ${embedFailed} embed failures` : ""}) in ${dir}`);
      } finally {
        db.close();
      }
    },
  );

  server.registerTool(
    'suplagentics_search_code',
    {
      title: 'Semantic code search',
      description:
        'Semantic search over an indexed codebase. Returns the most relevant code chunks for a ' +
        'natural-language query. USE THIS instead of grep/glob/read when exploring — massively ' +
        'reduces context usage. Call suplagentics_index_workspace first if not yet indexed.',
      inputSchema: {
        query: z.string().describe("Natural language: 'token expiry logic', 'how auth validates requests'"),
        directory: z.string().describe('Absolute path to the indexed project directory'),
        top_k: z.number().default(_S.rag_top_k ?? 3).describe('Number of results (default 3, max 8)'),
      },
    },
    async ({ query, directory, top_k }) => {
      const dir = resolve(directory);
      const db = await initDB();
      try {
        const ws = db.get('SELECT chunk_count FROM workspaces WHERE path = ?', dir);
        if (!ws) return asText(`Not indexed. Run suplagentics_index_workspace with directory:"${dir}" first.`);

        const qv = await embed(query);
        if (!qv) return asText('Embedding failed — is Ollama running?');

        const scoreRows = (rs) => rs.map((r) => ({
          file: r.file_path,
          lines: `${r.start_line}-${r.end_line}`,
          score: cosine(qv, blobToVec(r.embedding)),
          content: String(r.content).substring(0, 300),
        })).sort((a, b) => b.score - a.score).slice(0, Math.min(top_k, 8));

        let rows = db.all('SELECT file_path, start_line, end_line, content, embedding FROM chunks WHERE workspace = ?', dir);
        let scored = scoreRows(rows);

        // --- P0-2 staleness check: reindex stale top-hit files INLINE, then return fresh results.
        // Inline (not deferred/background) because `db` is closed in this handler's `finally` — a
        // fire-and-forget reindex would use a closed handle. top_k <= 8 and only stale top hits are
        // reindexed, so the added latency is bounded to the files actually being looked at.
        const topFiles = [...new Set(scored.map((r) => r.file))];
        let reindexedCount = 0;
        for (const f of topFiles) {
          if (await isFileStale(db, dir, f) && await reindexFile(db, dir, f)) reindexedCount++;
        }
        if (reindexedCount > 0) {
          rows = db.all('SELECT file_path, start_line, end_line, content, embedding FROM chunks WHERE workspace = ?', dir);
          scored = scoreRows(rows);
        }

        const out = scored.map((r, i) => `[${i + 1}] ${r.file}:${r.lines} (score: ${r.score.toFixed(3)})\n${r.content}`).join('\n\n---\n\n');
        const stalenessNote = reindexedCount > 0
          ? `\n\n[ℹ ${reindexedCount} file(s) re-indexed at query time — results are fresh]`
          : '';
        return asText((out || 'No results found.') + stalenessNote);
      } finally {
        db.close();
      }
    },
  );

  server.registerTool(
    'suplagentics_rag_status',
    {
      title: 'RAG index status',
      description: 'Check which workspaces are indexed for semantic search.',
      inputSchema: {},
    },
    async () => {
      const db = await initDB();
      try {
        const rows = db.all('SELECT path, indexed_at, chunk_count FROM workspaces ORDER BY indexed_at DESC');
        if (!rows.length) return asText(`No workspaces indexed yet.\n\nModel: ${EMBED_MODEL} @ ${OLLAMA_URL}`);
        const list = rows.map((r) => `  ${r.path}\n    ${r.chunk_count} chunks — indexed ${Math.round((Date.now() - r.indexed_at) / 60000)}m ago`).join('\n');
        return asText(`Indexed workspaces (${rows.length}):\n${list}\n\nModel: ${EMBED_MODEL} @ ${OLLAMA_URL}`);
      } finally {
        db.close();
      }
    },
  );
}
