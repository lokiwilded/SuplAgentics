#!/usr/bin/env node
// refresh — push repo to live config + refresh dashboard bun cache + rebuild
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.SUPAGENTICS_ROOT || findRoot();
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NO_BUILD = args.includes('--no-build');
const NO_PUSH = args.includes('--no-push');

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

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m', bold: '\x1b[1m' };
const syncScript = path.join(ROOT, 'sync-self.mjs');

console.log(`\n${c.bold}PI-Builder Refresh${c.x}${DRY ? c.d + ' (dry run)' + c.x : ''}\n`);

if (!NO_PUSH) {
  console.log(`${c.g}Step 1: Push repo \u2192 live config${c.x}`);
  try { execSync(`node "${syncScript}" push ${DRY ? '--dry' : ''}`, { cwd: ROOT, stdio: 'inherit' }); }
  catch (e) { console.log(`${c.r}Push failed. Stopping.${c.x}`); process.exit(1); }
} else {
  console.log(`${c.d}Skipping push (--no-push)${c.x}`);
}

console.log(`\n${c.g}Step 2: Refresh dashboard bun cache${c.x}`);
try { execSync(`node "${syncScript}" dash ${!NO_BUILD ? '--build' : ''} ${DRY ? '--dry' : ''}`, { cwd: ROOT, stdio: 'inherit' }); }
catch (e) { console.log(`${c.r}Dashboard refresh failed.${c.x}`); process.exit(1); }

console.log(`\n${c.g}\u2713 Refresh complete.${c.x}`);
if (!DRY) console.log(`${c.y}Restart the dashboard (node start.mjs) and opencode to pick up changes.${c.x}`);
console.log();
