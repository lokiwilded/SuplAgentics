#!/usr/bin/env node
// Validate agent/subagent markdown files have required frontmatter fields and correct value types.
// Usage: node validate-agents.js [path-to-oc-dir]
//
// Checks every .md file in agents/ and subagents/ for:
//   - Valid YAML frontmatter (--- delimited)
//   - Required fields: model, tools (or tools: [])
//   - `permission:` must be an object (not a YAML list) — opencode throws ConfigInvalidError otherwise
//   - Tool names in `permission:` should use the `suplagentics_` prefix
//   - `mode:` if present should be one of: primary, subagent

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { join } from 'node:path';

const ROOT = process.argv[2] || join(import.meta.url.replace('file:///', '').replace('/validate-agents.js', ''), '..', '..', 'OC');

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: null, body: content };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      // Detect YAML list syntax (starts with -) which is wrong for permission
      if (val.startsWith('-') || val.startsWith('[')) {
        meta[key] = { _raw: val, _isList: true };
      } else {
        meta[key] = val;
      }
    }
  }
  return { meta, body: m[2] || content.slice(m[0].length) };
}

const errors = [];
const warnings = [];

for (const sub of ['agents', 'subagents']) {
  const dir = join(ROOT, sub);
  if (!existsSync(dir)) { warnings.push(`${sub}/ directory not found at ${dir}`); continue; }
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(dir, name);
    const content = readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(content);

    if (meta === null) {
      errors.push(`${sub}/${name}: No YAML frontmatter found (must be --- delimited)`);
      continue;
    }

    // Required: model
    if (!meta.model) warnings.push(`${sub}/${name}: No 'model' field — will use system default`);
    if (meta.model && meta.model._isList) errors.push(`${sub}/${name}: 'model' must be a string, not a list`);

    // Required: tools (or explicit empty)
    // tools is optional — opencode provides default tool access through permission keys

    // permission must be an object, not a YAML list
    if (meta.permission) {
      if (meta.permission._isList) {
        errors.push(`${sub}/${name}: 'permission' must be an object (key: value), not a YAML list. opencode will throw ConfigInvalidError`);
      } else if (typeof meta.permission === 'string') {
        // Check for tool names without suplagentics_ prefix in permission values
        const toolNames = meta.permission.match(/\b(search_code|index_workspace|rag_status|read_cached|bash_cached|cache_status|import_scan|import_status|improvement_suggestions)\b/g);
        if (toolNames) {
          warnings.push(`${sub}/${name}: 'permission' references unprefixed tool names: ${toolNames.join(', ')} — should be suplagentics_${toolNames[0]}`);
        }
      }
    }

    // mode: must be valid
    if (meta.mode) {
      const modeVal = typeof meta.mode === 'string' ? meta.mode : meta.mode._raw;
      if (!['primary', 'subagent'].includes(modeVal.replace(/['"]/g, ''))) {
        errors.push(`${sub}/${name}: 'mode' must be 'primary' or 'subagent', got '${modeVal}'`);
      }
    }

    // Subagents must have mode: subagent
    if (sub === 'subagents' && (!meta.mode || (typeof meta.mode === 'string' ? !meta.mode.includes('subagent') : true))) {
      errors.push(`${sub}/${name}: Subagents must have 'mode: subagent' in frontmatter`);
    }
  }
}

if (errors.length) {
  console.error('❌ Validation errors:');
  for (const e of errors) console.error(`  ${e}`);
}
if (warnings.length) {
  console.warn('⚠ Validation warnings:');
  for (const w of warnings) console.warn(`  ${w}`);
}
if (!errors.length && !warnings.length) {
  console.log('✅ All agent files pass validation.');
}



// ── TypeScript plugin validation ──────────────────────────────────────────────
// The 3 core plugin .ts files must have valid syntax (opencode transpiles them at runtime,
// but we can at least check they parse as TypeScript-like).
const PLUGIN_DIR = path.join(ROOT, 'plugins');
if (existsSync(PLUGIN_DIR)) {
  const tsPlugins = readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.ts'));
  for (const name of tsPlugins) {
    const content = readFileSync(path.join(PLUGIN_DIR, name), 'utf8');
    // Basic checks: must have an import or export, must not be empty
    if (content.trim().length === 0) {
      errors.push(`plugins/${name}: File is empty`);
    }
    if (!content.includes('import') && !content.includes('export')) {
      warnings.push(`plugins/${name}: No import/export statements — may not be a valid TS plugin`);
    }
    // Check for the Plugin type import that opencode requires
    if (!content.includes('Plugin') && !content.includes('plugin')) {
      warnings.push(`plugins/${name}: No Plugin/plugin type reference — may not register correctly`);
    }
    // Check for the registerTool or register function pattern
    if (!content.includes('registerTool') && !content.includes('register(') && !content.includes('export')) {
      warnings.push(`plugins/${name}: No registerTool/register/export — may not hook into opencode`);
    }
  }
} else {
  warnings.push('plugins/ directory not found');
}

process.exit(errors.length > 0 ? 1 : 0);
