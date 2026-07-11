#!/usr/bin/env node
// SuplAgentics "sync self" — keep the repo (OC/, MCP/) and the running system in sync, in EITHER
// direction, so the system can safely work on itself. See plans/self-audit.md finding P0-1.
//
// Why this is bidirectional: agents/plugins RUN from ~/.config/opencode/, but the installer skips
// files that already exist there — so historically the live config drifted AHEAD of the repo
// (18/22 agents were hand-fixed live and never back-ported; the repo even referenced MCP tool names
// without the `suplagentics_` prefix that the live files had corrected). You must `pull` that drift
// back into the repo before the repo can be trusted as the source of truth again; after that, a
// self-edit made in the repo is propagated with `push`.
//
// What runs from where (verified live):
//   • agents   → ~/.config/opencode/agents/   (flattened from OC/agents + OC/subagents)
//   • plugins  → ~/.config/opencode/plugin/
//   • MCP server → opencode launches it straight from D:/SuplAgentics/MCP/src/index.js — NOT cached,
//                  so MCP engine/tool edits are already live on the next opencode restart.
//   • dashboard route code that `import`s suplagentics-mcp-server/src/... → bun-cached copy (`dash`).
//   • React UI → dist/ (`dash --build`).
//
// Usage (mode is REQUIRED — no accidental wrong-direction runs):
//   node sync-self.mjs pull [--dry]     # live ~/.config/opencode  →  repo OC/   (capture drift, including config)
//   node sync-self.mjs push [--dry]     # repo OC/  →  live ~/.config/opencode   (apply a self-edit, additive config merge)
//   node sync-self.mjs dash [--build]   # refresh the dashboard's bun-cached OC/MCP copy
//
// Reversible: OC/ is its own git repo — `git -C OC checkout .` undoes a bad pull; the live side is
// plain files under ~/.config/opencode/agents|plugin. Never touches opencode.json (live-only state).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OC = path.join(ROOT, 'OC');
const UI = path.join(ROOT, 'UI');
const CONFIG = path.join(os.homedir(), '.config', 'opencode');
const LIVE_AGENTS = path.join(CONFIG, 'agents');
const LIVE_PLUGINS = path.join(CONFIG, 'plugin');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const BUILD = args.includes('--build');
const mode = args.find((a) => !a.startsWith('--'));

const c = { g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', r: '\x1b[31m', x: '\x1b[0m' };
const log = (s) => console.log(s);
const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n'); // compare/write in LF

// The repo files this tool owns, each paired with its live counterpart. Iterating the REPO side
// (not the live dirs) means pull never vacuums in live-only files the repo doesn't manage.
function ownedPairs() {
  const pairs = [];
  for (const [sub, kind] of [['agents', 'agent'], ['subagents', 'agent'], ['plugins', 'plugin']]) {
    const srcDir = path.join(OC, sub);
    if (!existsSync(srcDir)) continue;
    const liveDir = kind === 'agent' ? LIVE_AGENTS : LIVE_PLUGINS;
    for (const name of readdirSync(srcDir)) {
      const repo = path.join(srcDir, name);
      if (!statSync(repo).isFile()) continue;
      pairs.push({ name, kind, repo, live: path.join(liveDir, name) });
    }
  }
  return pairs;
}

// direction: 'pull' writes live→repo, 'push' writes repo→live. Content is compared and written in
// LF so line-ending-only differences never count as a change.
function transfer(direction) {
  const from = direction === 'pull' ? 'live' : 'repo';
  const to = direction === 'pull' ? 'repo' : 'live';
  log(`\n${c.g}▸ ${direction}: ${from} → ${to}${c.x}${DRY ? c.d + '  (dry run)' + c.x : ''}`);
  const changed = [];
  for (const p of ownedPairs()) {
    const [srcPath, dstPath] = direction === 'pull' ? [p.live, p.repo] : [p.repo, p.live];
    if (!existsSync(srcPath)) {
      if (direction === 'pull') log(`  ${c.d}- no live copy of ${p.name} (repo-only)${c.x}`);
      continue;
    }
    const srcLF = norm(readFileSync(srcPath));
    const dstLF = existsSync(dstPath) ? norm(readFileSync(dstPath)) : null;
    if (srcLF === dstLF) continue;
    changed.push({ name: p.name, status: dstLF === null ? 'new' : 'updated' });
    if (!DRY) { mkdirSync(path.dirname(dstPath), { recursive: true }); writeFileSync(dstPath, srcLF, 'utf8'); }
  }
  if (!changed.length) { log(`  ${c.d}already in sync${c.x}`); return 0; }
  log(`  ${changed.length} file(s) ${DRY ? 'would change' : 'written to ' + to}:`);
  for (const f of changed) log(`    ${f.status === 'new' ? c.g + '+' : c.y + '~'} ${f.name}${c.x}`);
  if (!DRY && direction === 'pull') log(`\n  ${c.y}Review: git -C OC diff   |   Revert: git -C OC checkout .${c.x}`);
  if (!DRY && direction === 'push') log(`\n  ${c.y}⟳ Restart opencode${c.x} to load the changed agents/plugins (it reads them at startup).`);
  return changed.length;
}

// Sync config files (opencode.json and suplagentics-settings.json) with additive merge.
// push: repo → live (additive — never overwrites a key the user already set)
// pull: live → repo (overwrite — live is authoritative for config)
function syncConfig(direction) {
  const from = direction === 'pull' ? 'live' : 'repo';
  const to = direction === 'pull' ? 'repo' : 'live';
  log(`
${c.g}▸ config: ${direction} (settings + opencode.json)${c.x}${DRY ? c.d + '  (dry run)' + c.x : ''}`);
  const changed = [];

  // suplagentics-settings.json — pull overwrites, push merges (adds missing keys only)
  const settingsPairs = [
    { repo: path.join(OC, 'suplagentics-settings.json'), live: path.join(CONFIG, 'suplagentics-settings.json') },
  ];
  // opencode.json — pull overwrites, push merges (additive: never overwrites user-set keys)
  const ocPairs = [
    { repo: path.join(OC, 'opencode.json'), live: path.join(CONFIG, 'opencode.json') },
  ];

  for (const { repo, live } of [...settingsPairs, ...ocPairs]) {
    const [srcPath, dstPath] = direction === 'pull' ? [live, repo] : [repo, live];
    if (!existsSync(srcPath)) continue;
    const srcLF = norm(readFileSync(srcPath));

    if (direction === 'push' && existsSync(dstPath)) {
      // Additive merge for push: only add keys that don't exist in the destination
      const srcObj = JSON.parse(srcLF);
      let dstContent;
      try { dstContent = JSON.parse(norm(readFileSync(dstPath))); } catch { dstContent = {}; }
      // Deep-merge nested objects (provider.*, agent.*) so inner keys like
      // provider.ollama-cloud.options.* and provider.ollama-cloud.models.* propagate.
      // dst still wins on scalar conflicts (user customization preserved).
      function deepMerge(src, dst) {
        const out = { ...dst };
        for (const [k, v] of Object.entries(src)) {
          if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) {
            out[k] = deepMerge(v, dst[k]); // both objects → recurse
          } else if (!(k in dst)) {
            out[k] = v; // only add keys the user hasn't set
          }
          // else: dst wins — user's value preserved
        }
        return out;
      }
      const before = JSON.stringify(dstContent);
      const merged = deepMerge(srcObj, dstContent);
      // Also ensure any arrays from src are merged (plugins). Dedupe by VALUE, not identity:
      // a plugin entry can be a string OR a tuple like ["opencode-log-sanitizer", {opts}], and
      // `new Set` never collapses two equal-but-distinct tuples — that duplicated the sanitizer.
      if (Array.isArray(srcObj.plugin) && Array.isArray(dstContent.plugin)) {
        const seen = new Set();
        merged.plugin = [...dstContent.plugin, ...srcObj.plugin].filter((p) => {
          const key = typeof p === 'string' ? p : JSON.stringify(p);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      const after = JSON.stringify(merged);
      if (before === after) continue; // no change
      changed.push({ name: path.basename(dstPath), status: 'merged' });
      if (!DRY) writeFileSync(dstPath, JSON.stringify(merged, null, 2) + String.fromCharCode(10), `utf8`);
    } else {
      // Pull: overwrite (live is authoritative)
      if (existsSync(dstPath)) {
        const dstLF = norm(readFileSync(dstPath));
        if (srcLF === dstLF) continue;
      }
      changed.push({ name: path.basename(dstPath), status: existsSync(dstPath) ? 'updated' : 'new' });
      if (!DRY) { mkdirSync(path.dirname(dstPath), { recursive: true }); writeFileSync(dstPath, srcLF, 'utf8'); }
    }
  }

  if (!changed.length) { log(`  ${c.d}config already in sync${c.x}`); return 0; }
  log(`  ${changed.length} config file(s) ${DRY ? 'would change' : 'synced'}:`);
  for (const f of changed) log(`    ${c.y}~ ${f.name}${c.x} (${f.status})`);
  return changed.length;
}

function syncDash() {
  log(`\n${c.g}▸ dash: refresh the dashboard's bun-cached OC/MCP copy${c.x}${DRY ? c.d + '  (dry run)' + c.x : ''}`);
  const targets = [
    path.join(UI, 'node_modules', '.bun', 'suplagentics-opencode@file+..+OC'),
    path.join(UI, 'node_modules', '.bun', 'suplagentics-mcp-server@file+..+MCP'),
    path.join(UI, 'packages', 'web', 'node_modules', 'suplagentics-opencode'),
    path.join(UI, 'packages', 'web', 'node_modules', 'suplagentics-mcp-server'),
  ];
  for (const t of targets) {
    const present = existsSync(t);
    log(`  ${present ? c.y + '- remove ' : c.d + '- absent '}${c.x}${path.relative(UI, t)}`);
    if (present && !DRY) rmSync(t, { recursive: true, force: true });
  }
  if (DRY) { log(`  ${c.d}would then run: bun install${BUILD ? ' && bun run build' : ''} (in UI/)${c.x}`); return 0; }
  log(`\n  ${c.g}bun install${c.x} (in UI/)…`);
  if (spawnSync('bun', ['install'], { cwd: UI, stdio: 'inherit', shell: true }).status !== 0) {
    log(`  ${c.r}bun install failed.${c.x}`); return 1;
  }
  if (BUILD) {
    log(`\n  ${c.g}bun run build${c.x} (in UI/)…`);
    if (spawnSync('bun', ['run', 'build'], { cwd: UI, stdio: 'inherit', shell: true }).status !== 0) {
      log(`  ${c.r}build failed.${c.x}`); return 1;
    }
  }
  log(`\n  ${c.y}⟳ Restart the dashboard${c.x} (node start.mjs) to load refreshed route code.`);
  return 0;
}

if (!['pull', 'push', 'dash'].includes(mode)) {
  log(`${c.r}Mode required.${c.x} Usage:
  node sync-self.mjs pull [--dry]     live → repo   (capture drift into OC/)
  node sync-self.mjs push [--dry]     repo → live   (apply a self-edit)
  node sync-self.mjs dash [--build]   refresh the dashboard's bun cache`);
  process.exit(2);
}
log(`${c.d}sync-self — ${mode}${DRY ? ' (dry)' : ''}${c.x}`);
// dash returns 0/1 (1 = real failure); transfer's return is a change COUNT, not a status — a
// sync that changed files is a success, so it must not leak into a non-zero exit.
if (mode === 'dash') process.exit(syncDash());
transfer(mode);
syncConfig(mode);
process.exit(0);
