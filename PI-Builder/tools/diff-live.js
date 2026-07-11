#!/usr/bin/env node
// diff-live — compare repo OC/ files against live ~/.config/opencode/ files
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.env.SUPAGENTICS_ROOT || findRoot();
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const OC = path.join(ROOT, 'OC');
const CONFIG = path.join(os.homedir(), '.config', 'opencode');

function findRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'OC')) && existsSync(path.join(dir, 'MCP')) && existsSync(path.join(dir, 'UI'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'D:/SuplAgentics';
}

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[34m', d: '\x1b[2m', x: '\x1b[0m', bold: '\x1b[1m' };
function norm(buf) { return buf.replace(/\r\n/g, '\n').trimEnd(); }
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  try { return readdirSync(dir).filter(f => statSync(path.join(dir, f)).isFile()); }
  catch { return []; }
}

function compareFiles() {
  const results = [];
  const pairs = [
    { repoDirs: [path.join(OC, 'agents'), path.join(OC, 'subagents')], liveDir: path.join(CONFIG, 'agents'), kind: 'agent' },
    { repoDirs: [path.join(OC, 'plugins')], liveDir: path.join(CONFIG, 'plugin'), kind: 'plugin' },
  ];
  for (const { repoDirs, liveDir, kind } of pairs) {
    for (const repoDir of repoDirs) {
      if (!existsSync(repoDir)) continue;
      const repoFiles = listFiles(repoDir);
      for (const name of repoFiles) {
        const repoPath = path.join(repoDir, name);
        const livePath = path.join(liveDir, name);
        if (!existsSync(livePath)) { results.push({ name, kind, status: 'repo-only', diff: null }); continue; }
        const repoContent = norm(readFileSync(repoPath, 'utf8'));
        const liveContent = norm(readFileSync(livePath, 'utf8'));
        if (repoContent === liveContent) { results.push({ name, kind, status: 'synced', diff: null }); }
        else {
          const repoLines = repoContent.split('\n').length;
          const liveLines = liveContent.split('\n').length;
          const diff = liveLines - repoLines;
          results.push({ name, kind, status: 'drifted', diff: `+${diff > 0 ? diff : 0}/-${diff < 0 ? Math.abs(diff) : 0} lines (live vs repo)`, repoLines, liveLines });
        }
      }
    }
    // Check for live-only files
    const liveFiles = listFiles(liveDir);
    const allRepoNames = new Set(repoDirs.flatMap(d => existsSync(d) ? listFiles(d) : []));
    for (const name of liveFiles) {
      if (!allRepoNames.has(name)) results.push({ name, kind, status: 'live-only', diff: null });
    }
  }
  // Settings
  const repoSettings = path.join(OC, 'suplagentics-settings.json');
  const liveSettings = path.join(CONFIG, 'suplagentics-settings.json');
  if (existsSync(repoSettings) && existsSync(liveSettings)) {
    const repoContent = norm(readFileSync(repoSettings, 'utf8'));
    const liveContent = norm(readFileSync(liveSettings, 'utf8'));
    results.push({ name: 'suplagentics-settings.json', kind: 'settings', status: repoContent === liveContent ? 'synced' : 'drifted', diff: null });
  }
  return results;
}

console.log(`\n${c.bold}${c.b}SuplAgentics — Repo vs Live Config Diff${c.x}\n`);
console.log(`${c.d}Repo:  ${OC}${c.x}`);
console.log(`${c.d}Live:  ${CONFIG}${c.x}\n`);
const results = compareFiles();
const synced = results.filter(r => r.status === 'synced');
const drifted = results.filter(r => r.status === 'drifted');
const repoOnly = results.filter(r => r.status === 'repo-only');
const liveOnly = results.filter(r => r.status === 'live-only');

console.log(`${c.g}Synced:    ${synced.length}${c.x}`);
console.log(`${c.y}Drifted:   ${drifted.length}${c.x}`);
console.log(`${c.b}Repo-only: ${repoOnly.length}${c.x}`);
console.log(`${c.r}Live-only: ${liveOnly.length}${c.x}\n`);

if (drifted.length > 0) {
  console.log(`${c.bold}Drifted files:${c.x}`);
  for (const f of drifted) {
    console.log(`  ${c.y}~ ${f.name}${c.x} (${f.kind}) ${f.diff || ''}`);
    if (VERBOSE && f.repoLines !== undefined) console.log(`    repo: ${f.repoLines} lines | live: ${f.liveLines} lines`);
  }
  console.log();
}
if (liveOnly.length > 0) {
  console.log(`${c.bold}Live-only (not in repo):${c.x}`);
  for (const f of liveOnly) console.log(`  ${c.r}+ ${f.name}${c.x} (${f.kind})`);
  console.log();
}
if (repoOnly.length > 0) {
  console.log(`${c.bold}Repo-only (not yet installed):${c.x}`);
  for (const f of repoOnly) console.log(`  ${c.b}- ${f.name}${c.x} (${f.kind})`);
  console.log();
}
if (drifted.length > 0 || liveOnly.length > 0) {
  console.log(`${c.y}Pull live changes into repo:  node sync-self.mjs pull${c.x}`);
  console.log(`${c.y}Push repo changes to live:    node sync-self.mjs push${c.x}`);
  console.log(`${c.y}Refresh dashboard cache:       node sync-self.mjs dash${c.x}\n`);
} else {
  console.log(`${c.g}Everything in sync.${c.x}\n`);
}
