#!/usr/bin/env node
// sync — thin wrapper around SuplAgentics' own sync-self.mjs
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.SUPAGENTICS_ROOT || findRoot();
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

const syncScript = path.join(ROOT, 'sync-self.mjs');
if (!existsSync(syncScript)) { console.error(`sync-self.mjs not found at ${syncScript}`); process.exit(1); }

const args = process.argv.slice(2);
const mode = args[0];
if (!['pull', 'push', 'dash'].includes(mode)) {
  console.log('Usage: node tools/sync.js pull|push|dash [--dry] [--build]');
  console.log('  pull  — live ~/.config/opencode \u2192 repo OC/');
  console.log('  push  — repo OC/ \u2192 live ~/.config/opencode');
  console.log('  dash  — refresh the dashboard bun-cached copy of OC/MCP');
  process.exit(1);
}
try { execSync(`node "${syncScript}" ${args.join(' ')}`, { cwd: ROOT, stdio: 'inherit' }); }
catch (e) { process.exit(e.status || 1); }
