#!/usr/bin/env node
// audit-scanner — reads the self-audit and cross-references with live code
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[34m', d: '\x1b[2m', x: '\x1b[0m', bold: '\x1b[1m' };
const auditPath = path.join(ROOT, 'plans', 'self-audit.md');
if (!existsSync(auditPath)) { console.log(`${c.r}No self-audit.md found at ${auditPath}${c.x}`); process.exit(1); }

const audit = readFileSync(auditPath, 'utf8');
const lines = audit.split('\n');
const findings = [];
let current = null;
for (const line of lines) {
  const m = line.match(/^### (.+)/);
  if (m) { if (current) findings.push(current); current = { id: m[1], title: m[1], lines: [], resolved: false, severity: 'P2' }; }
  if (current) {
    current.lines.push(line);
    if (line.includes('\u2705 RESOLVED')) current.resolved = true;
    const sevMatch = line.match(/\[(\w+)\]/);
    if (sevMatch) current.severity = sevMatch[1];
  }
}
if (current) findings.push(current);

// Extract file references
const filePattern = /[`']([^`']+\.(js|ts|json|md))['`]/g;
for (const f of findings) {
  f.files = [];
  for (const line of f.lines) {
    let match;
    while ((match = filePattern.exec(line)) !== null) {
      const file = match[1];
      const fullPath = path.resolve(ROOT, file);
      f.files.push({ ref: file, exists: existsSync(fullPath) });
    }
    filePattern.lastIndex = 0;
  }
  const seen = new Set();
  f.files = f.files.filter(f => { if (seen.has(f.ref)) return false; seen.add(f.ref); return true; });
}

console.log(`\n${c.bold}${c.b}SuplAgentics Audit Scanner${c.x}\n`);
console.log(`${c.d}Root: ${ROOT}${c.x}`);
console.log(`${c.d}Findings: ${findings.length} total, ${findings.filter(f => f.resolved).length} resolved${c.x}\n`);

const open = findings.filter(f => !f.resolved);
if (open.length === 0) {
  console.log(`${c.g}All findings resolved! Nice.${c.x}\n`);
} else {
  console.log(`${c.bold}Open findings:${c.x}\n`);
  for (const f of open) {
    const sevColor = f.severity === 'P0' ? c.r : f.severity === 'P1' ? c.y : c.d;
    console.log(`  ${sevColor}[${f.severity}]${c.x} ${f.title}`);
    for (const file of f.files) {
      const mark = file.exists ? c.g : c.r;
      console.log(`    ${mark}${file.ref}${c.x} ${file.exists ? '' : '(missing)'}`);
    }
    if (f.files.length === 0) console.log(`    ${c.d}(no file references in this finding)${c.x}`);
    console.log();
  }
}

console.log(`${c.bold}Summary:${c.x}`);
const sevCounts = {};
for (const f of open) sevCounts[f.severity] = (sevCounts[f.severity] || 0) + 1;
for (const [sev, count] of Object.entries(sevCounts).sort()) {
  const color = sev === 'P0' ? c.r : sev === 'P1' ? c.y : c.d;
  console.log(`  ${color}${sev}: ${count}${c.x}`);
}
console.log();
