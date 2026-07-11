#!/usr/bin/env node
// PI-Builder fixer — interactive CLI for working on SuplAgentics
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';

const ROOT = process.env.SUPAGENTICS_ROOT || findRoot();
const OC = path.join(ROOT, 'OC');
const MCP = path.join(ROOT, 'MCP');
const UI = path.join(ROOT, 'UI');
const CONFIG = path.join(os.homedir(), '.config', 'opencode');

function findRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'OC')) && existsSync(path.join(dir, 'MCP')) && existsSync(path.join(dir, 'UI')))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'D:/SuplAgentics';
}

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[34m', d: '\x1b[2m', bold: '\x1b[1m', x: '\x1b[0m' };

function gitStatus(dir) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim();
    const short = execSync('git log --oneline -1', { cwd: dir, encoding: 'utf8' }).trim();
    return { branch, dirty: dirty ? dirty.split('\n').length : 0, lastCommit: short };
  } catch {
    return { branch: '(not a git repo)', dirty: '?', lastCommit: '?' };
  }
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  try { return readdirSync(dir).filter(f => statSync(path.join(dir, f)).isFile()); }
  catch { return []; }
}

function diffLive() {
  const liveAgents = path.join(CONFIG, 'agents');
  const livePlugins = path.join(CONFIG, 'plugin');
  const drift = [];
  const pairs = [
    { repoDirs: [path.join(OC, 'agents'), path.join(OC, 'subagents')], liveDir: liveAgents, kind: 'agent' },
    { repoDirs: [path.join(OC, 'plugins')], liveDir: livePlugins, kind: 'plugin' },
  ];
  for (const { repoDirs, liveDir, kind } of pairs) {
    for (const repoDir of repoDirs) {
      if (!existsSync(repoDir)) continue;
      for (const name of listFiles(repoDir)) {
        const liveFile = path.join(liveDir, name);
        if (!existsSync(liveFile)) { drift.push({ name, status: 'repo-only' }); continue; }
        try {
          const repoContent = readFileSync(path.join(repoDir, name), 'utf8').replace(/\r\n/g, '\n');
          const liveContent = readFileSync(liveFile, 'utf8').replace(/\r\n/g, '\n');
          if (repoContent !== liveContent) drift.push({ name, status: 'drifted' });
        } catch { drift.push({ name, status: 'error' }); }
      }
    }
  }
  // settings
  const repoS = path.join(OC, 'suplagentics-settings.json');
  const liveS = path.join(CONFIG, 'suplagentics-settings.json');
  if (existsSync(repoS) && existsSync(liveS)) {
    try {
      const rc = readFileSync(repoS, 'utf8').replace(/\r\n/g, '\n');
      const lc = readFileSync(liveS, 'utf8').replace(/\r\n/g, '\n');
      if (rc !== lc) drift.push({ name: 'suplagentics-settings.json', status: 'drifted' });
    } catch { /* skip */ }
  }
  return drift;
}

function printHeader() {
  console.log(`\n${c.bold}${c.b}╔══════════════════════════════════════════════════╗${c.x}`);
  console.log(`${c.bold}${c.b}║  PI-Builder Fixer — SuplAgentics Meta-Agent    ║${c.x}`);
  console.log(`${c.bold}${c.b}╚══════════════════════════════════════════════════╝${c.x}\n`);
  console.log(`${c.d}Root: ${ROOT}${c.x}`);

  for (const [label, dir] of [['OC', OC], ['MCP', MCP], ['UI', UI]]) {
    if (!existsSync(dir)) { console.log(`  ${c.d}${label}: not found${c.x}`); continue; }
    const s = gitStatus(dir);
    const dirtyMark = s.dirty > 0 ? `${c.y}${s.dirty} dirty${c.x}` : `${c.g}clean${c.x}`;
    console.log(`  ${c.b}${label}${c.x}: ${s.branch} | ${dirtyMark} | ${s.lastCommit}`);
  }

  const drift = diffLive();
  if (drift.length > 0) {
    console.log(`\n  ${c.y}Drift detected:${c.x}`);
    for (const d of drift.slice(0, 10))
      console.log(`    ${d.status === 'drifted' ? c.y : c.d}${d.name}${c.x} (${d.status})`);
    if (drift.length > 10) console.log(`    ${c.d}... and ${drift.length - 10} more${c.x}`);
  } else {
    console.log(`\n  ${c.g}No drift between repo and live config${c.x}`);
  }

  const auditPath = path.join(ROOT, 'plans', 'self-audit.md');
  if (existsSync(auditPath)) {
    const audit = readFileSync(auditPath, 'utf8');
    const findings = (audit.match(/### .+/g) || []).length;
    const resolved = (audit.match(/✅ RESOLVED/g) || []).length;
    console.log(`\n  ${c.d}Self-audit: ${findings} findings (${resolved} resolved)${c.x}`);
  }

  console.log(`\n${c.d}Commands: scan | diff | sync pull|push [--dry] | refresh [--build] | status | quit${c.x}\n`);
}

function runSync(args) {
  const mode = args[0];
  if (!['pull', 'push'].includes(mode)) { console.log(`${c.r}Usage: sync pull|push [--dry]${c.x}`); return; }
  const cmd = `node "${path.join(ROOT, 'sync-self.mjs')}" ${mode} ${args.includes('--dry') ? '--dry' : ''}`;
  console.log(`${c.d}$ ${cmd}${c.x}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function runRefresh(args) {
  const build = args.includes('--build');
  const cmd = `node "${path.join(ROOT, 'sync-self.mjs')}" dash ${build ? '--build' : ''}`;
  console.log(`${c.d}$ ${cmd}${c.x}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function runDiff() {
  const drift = diffLive();
  if (drift.length === 0) { console.log(`${c.g}Repo and live config are in sync.${c.x}`); return; }
  console.log(`${c.y}Drift between repo and live config:${c.x}`);
  for (const d of drift) console.log(`  ${d.status === 'drifted' ? c.y : c.d}${d.name}${c.x} — ${d.status}`);
  console.log(`\n${c.d}sync pull — bring live changes into repo${c.x}`);
  console.log(`${c.d}sync push — apply repo changes to live${c.x}`);
}

function runScan() {
  const auditPath = path.join(ROOT, 'plans', 'self-audit.md');
  if (!existsSync(auditPath)) { console.log(`${c.y}No self-audit.md found${c.x}`); return; }
  const audit = readFileSync(auditPath, 'utf8');
  const findings = [];
  let current = null;
  for (const line of audit.split('\n')) {
    const m = line.match(/^### (.+)/);
    if (m) { if (current) findings.push(current); current = { title: m[1], resolved: false }; }
    if (current && line.includes('✅ RESOLVED')) current.resolved = true;
  }
  if (current) findings.push(current);
  console.log(`\n${c.bold}Findings:${c.x}`);
  for (const f of findings) console.log(`  ${f.resolved ? c.g + '✅' : c.y + '⏳'}${c.x} ${f.title}`);
  console.log();
}

const args = process.argv.slice(2);
if (args.includes('--scan')) { printHeader(); runScan(); process.exit(0); }

printHeader();
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt(`${c.g}pi>${c.x} `);
rl.prompt();
rl.on('line', (input) => {
  const trimmed = input.trim();
  if (!trimmed) { rl.prompt(); return; }
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case 'scan': runScan(); break;
    case 'diff': runDiff(); break;
    case 'sync': runSync(parts.slice(1)); break;
    case 'refresh': runRefresh(parts.slice(1)); break;
    case 'status': printHeader(); break;
    case 'quit': case 'exit': rl.close(); return;
    default: console.log(`${c.d}Unknown: ${trimmed}. Commands: scan diff sync pull|push refresh status quit${c.x}`);
  }
  rl.prompt();
});
rl.on('close', () => { console.log(`\n${c.d}Bye.${c.x}\n`); process.exit(0); });
