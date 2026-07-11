#!/usr/bin/env node
// SuplAgentics launcher — starts the dashboard (UI + server) in one command.
//
//   node start.mjs [port]        # default port 3910
//
// The three folders link up like this:
//   • UI/  — the dashboard. `web` depends on MCP (engine) + OC (scaffolding) via file: deps.
//   • MCP/ — the server opencode launches (registered in ~/.config/opencode/opencode.json as
//            `node <this path>/MCP/src/index.js`). You don't start it here — opencode does.
//   • OC/  — the agents/plugins/skills the dashboard's first-run setup installs into ~/.config/opencode.
//
// First run: open the dashboard → Settings → run SuplAgentics setup (installs OC + registers MCP).
// Phone access (same Tailscale/LAN): node UI/packages/web/bin/cli.js connect-url
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(root, 'UI', 'packages', 'web', 'bin', 'cli.js');
const port = process.argv[2] || '3910';

// Verify the three-folder structure exists (required for file: dependencies)
for (const dir of ['OC', 'MCP', 'UI']) {
  if (!existsSync(path.join(root, dir))) {
    console.error(`
  Missing required directory: ${dir}/
  SuplAgentics requires OC/, MCP/, and UI/ to be present alongside start.mjs.
  If you cloned only one package, see README.md for the full layout.
`);
    process.exit(1);
  }
}

// Verify file: dependencies point to valid locations
const webPkg = JSON.parse(readFileSync(path.join(root, 'UI', 'packages', 'web', 'package.json'), 'utf8'));
for (const [name, spec] of Object.entries(webPkg.dependencies || {})) {
  if (typeof spec === 'string' && spec.startsWith('file:')) {
    const depPath = path.resolve(path.join(root, 'UI', 'packages', 'web'), spec.replace('file:', ''));
    if (!existsSync(depPath)) {
      console.error(`
  Broken file: dependency: ${name} -> ${spec}
  Expected at: ${depPath}
  Run 'cd UI && bun install' to resolve.
`);
      process.exit(1);
    }
  }
}

if (!existsSync(path.join(root, 'UI', 'node_modules'))) {
  console.error('\n  Dependencies not installed. Run first:\n    cd UI && bun install\n    cd ../MCP && bun install\n    cd ../UI && bun run build\n');
  process.exit(1);
}

console.log(`\n  Starting SuplAgentics dashboard on http://localhost:${port}`);
console.log(`  Phone/LAN access: node UI/packages/web/bin/cli.js connect-url\n`);
spawn('node', [cli, 'serve', '--port', port], { stdio: 'inherit', cwd: path.join(root, 'UI', 'packages', 'web') })
  .on('exit', (code) => process.exit(code ?? 0));
