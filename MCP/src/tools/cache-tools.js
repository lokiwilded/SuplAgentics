import { z } from 'zod';
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

// File/bash caching tools, ported from the opencode plugin ./plugin/suplagentics-cache.ts into this
// MCP server (see plans/openchamber-fork-port.md). Pure fs — no sqlite, no runtime-specific APIs, so
// this port is behaviourally identical to the plugin. Note for callers: bash_cached runs commands in
// THIS server process's cwd unless you pass `cwd` — always pass an absolute cwd for repo-scoped work.

const CACHE_DIR     = join(homedir(), '.local', 'share', 'opencode', 'suplagentics-cache');
const SETTINGS_PATH = join(homedir(), '.config', 'opencode', 'suplagentics-settings.json');
mkdirSync(CACHE_DIR, { recursive: true });

function loadSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {}
  return {};
}
const _S = loadSettings();
const READ_CAP   = _S.cache_read_cap_chars ?? 15_000;
const BASH_CAP   = _S.cache_bash_cap_chars ?? 8_000;
const MAX_AGE_MS = (_S.cache_max_age_hours ?? 24) * 3_600_000;


// Commands that should never run through bash_cached (destructive / side-effecting).
// Best-effort defence-in-depth, NOT a hard guarantee: it's trivially bypassable (/bin/rm,
// `bash -c 'rm …'`, env indirection), so the real contract is still "read-only queries only"
// per the tool description. Patterns anchor the command word to command position — start of string
// or just after a shell separator (; && || |) — so a destructive verb used as an ARGUMENT
// (`grep rm file`, `mydel.sh`) is not blocked, while `rm -rf`, `foo && rm x`, `foo; del y` are.
// (Prior versions used `\bs` — a typo for `\s` — which matched nothing and let `rm -rf` through.)
const DENIED_COMMANDS = [
  /(^|[;&|]\s*)(rm|rmdir|del|delete|format|mkfs|shutdown|reboot|halt)(\s|$)/i,
  /(^|[;&|]\s*)dd\s+/i,
];

export function isCommandDenied(cmd) {
  return DENIED_COMMANDS.some(pattern => pattern.test(cmd));
}

// One sweep per process start — entries are otherwise only skipped when stale on read, never deleted.
function evictStaleEntries() {
  let files;
  try { files = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    const full = join(CACHE_DIR, f);
    try {
      const { ts } = JSON.parse(readFileSync(full, 'utf8'));
      if (Date.now() - ts > MAX_AGE_MS) unlinkSync(full);
    } catch { try { unlinkSync(full); } catch {} }
  }
}
evictStaleEntries();

function key(s) { return createHash('sha1').update(s).digest('hex'); }

function readEntry(k, maxAgeMs) {
  const f = join(CACHE_DIR, k + '.json');
  if (!existsSync(f)) return null;
  try {
    const { ts, value } = JSON.parse(readFileSync(f, 'utf8'));
    return Date.now() - ts < maxAgeMs ? value : null;
  } catch { return null; }
}

function writeEntry(k, value) {
  writeFileSync(join(CACHE_DIR, k + '.json'), JSON.stringify({ ts: Date.now(), value }), 'utf8');
}

const asText = (text) => ({ content: [{ type: 'text', text }] });

export function registerCacheTools(server) {
  server.registerTool(
    'suplagentics_read_cached',
    {
      title: 'Read a file with caching',
      description:
        'Read a file with caching — instant on repeated reads if the file is unchanged. Prefer this ' +
        'over a plain read for files you may read more than once. Large files are truncated.',
      inputSchema: {
        path: z.string().describe('Absolute path to the file'),
      },
    },
    async ({ path }) => {
      if (!existsSync(path)) return asText(`File not found: ${path}`);
      try {
        const mtime = statSync(path).mtimeMs;
        const k = key(path + ':' + mtime);
        const cached = readEntry(k, 3_600_000);
        if (cached !== null) return asText(cached);
        const content = readFileSync(path, 'utf8');
        const out = content.length > READ_CAP
          ? content.slice(0, READ_CAP) + `\n\n[... truncated — file is ${content.length} chars, showing first ${READ_CAP}. Use grep/suplagentics_search_code for specific sections.]`
          : content;
        writeEntry(k, out);
        return asText(out);
      } catch (e) { return asText(`Error: ${e.message}`); }
    },
  );

  server.registerTool(
    'suplagentics_bash_cached',
    {
      title: 'Run a shell command with cached output',
      description:
        'Run a shell command and cache the output. Use for repeated status checks (git status, build ' +
        'output, test results) where the result will not change for a short window. Do NOT use for ' +
        'commands with side effects. Pass an absolute `cwd` for repo-scoped commands.',
      inputSchema: {
        command: z.string().describe('Shell command to run'),
        ttl_seconds: z.number().default(30).describe('Cache TTL in seconds (default 30)'),
        cwd: z.string().optional().describe('Absolute working directory'),
      },
    },
    async ({ command, ttl_seconds, cwd }) => {
      // Resolve cwd to process.cwd() when omitted, so the cache key is always directory-specific
      // (prevents stale cross-directory hits when the same command runs in different repos)
      const resolvedCwd = cwd || process.cwd();
      const k = key(command + resolvedCwd);
      if (isCommandDenied(command)) return asText(`Command blocked by safety denylist. bash_cached is for read-only queries (git status, test runs, etc.), not commands with side effects. Command: ${command}`);
      const cached = readEntry(k, ttl_seconds * 1000);
      if (cached !== null) return asText(cached);
      try {
        const raw = execSync(command, { cwd: resolvedCwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 512 * 1024 });
        const output = raw.length > BASH_CAP ? raw.slice(0, BASH_CAP) + `\n[... truncated — ${raw.length} chars total]` : raw;
        writeEntry(k, output);
        return asText(output);
      } catch (e) {
        // Do NOT cache failures (B-6): a transient error (e.g. `git status` in a non-repo, or a
        // command that briefly fails) must not be replayed for the whole TTL window. Return the
        // output to the caller, but never persist it.
        const raw = (e.stdout || '') + (e.stderr || '') || String(e);
        const out = raw.length > BASH_CAP ? raw.slice(0, BASH_CAP) + '\n[... truncated]' : raw;
        return asText(out);
      }
    },
  );

  server.registerTool(
    'suplagentics_cache_status',
    {
      title: 'Inspect the file/bash cache',
      description: "List what's in the file and bash caches — useful for debugging.",
      inputSchema: {},
    },
    async () => {
      try {
        const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
        const entries = files.slice(-20).map((f) => {
          try {
            const { ts } = JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf8'));
            return `  ${f.slice(0, 12)} — ${Math.round((Date.now() - ts) / 1000)}s old`;
          } catch { return null; }
        }).filter(Boolean);
        return asText(`Cache dir: ${CACHE_DIR}\nEntries: ${files.length}\n\nRecent:\n${entries.join('\n')}`);
      } catch (e) { return asText(`Error: ${e.message}`); }
    },
  );
}
