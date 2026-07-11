// Pure filesystem logic for Improvement suggestions — reading/writing suggestion .md files and
// their frontmatter, no session/subagent dependency. Moved from the OpenChamber fork's
// packages/web/server/lib/suplagentics/improvement-routes.js (see the approved MCP server
// architecture plan, section 2).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureSuplagenticsHome } from '../../suplagentics-home.js';

export const GLOBAL_IMPROVEMENTS_DIR = path.join(os.homedir(), '.config', 'opencode', 'improvements');
// Global-scope suggestions (cross-project patterns, not owned by any single tracked project) get
// approved into a plan and built against this personal space rather than any specific cloned
// repo — see suplagentics-home.js's own comment for why this isn't tied to a git checkout path.
export const SUPLAGENTICS_HOME = ensureSuplagenticsHome();

export function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: m[2] };
}

export function patchStatus(content, status) {
  const fmMatch = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (!fmMatch) return content;
  const fm = fmMatch[1].replace(/^status:.*$/m, `status: ${status}`);
  return fm + content.slice(fmMatch[1].length);
}

export function listSuggestions(improvementsDir, kind, defaultScope) {
  const dir = path.join(improvementsDir, kind);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    try {
      const content = readFileSync(path.join(dir, f), 'utf8');
      const { meta, body } = parseFrontmatter(content);
      out.push({
        file: f,
        status: meta.status || 'pending',
        type: meta.type || kind.slice(0, -1),
        title: meta.title || f.replace('.md', ''),
        frequency_signal: meta.frequency_signal || '',
        created_at: meta.created_at || '',
        problem: (body.match(/## Problem\r?\n([\s\S]*?)(?:\r?\n##|$)/) || [])[1]?.trim() || '',
        body: body.trim(),
        scope: meta.scope === 'global' || meta.scope === 'project' ? meta.scope : defaultScope,
      });
    } catch { /* skip unreadable/malformed suggestion file */ }
  }
  return out;
}

export function countSuggestions(improvementsDir, kind) {
  const dir = path.join(improvementsDir, kind);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

export function mergeSuggestions(directory, kind) {
  const projectList = listSuggestions(path.join(directory, 'improvements'), kind, 'project');
  const globalList = listSuggestions(GLOBAL_IMPROVEMENTS_DIR, kind, 'global');
  return [...projectList, ...globalList].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

// A suggestion's real location is resolved by checking where its file actually lives, not by
// trusting a client-supplied scope — a project-scoped file wins if both somehow exist.
export function resolveSuggestionLocation(directory, kind, file) {
  const projectPath = path.join(directory, 'improvements', kind, file);
  if (existsSync(projectPath)) {
    return {
      suggestionPath: projectPath,
      sidecarDir: path.join(directory, 'improvements', kind),
      plansDir: path.join(directory, 'plans'),
      buildCwd: directory,
    };
  }
  const globalPath = path.join(GLOBAL_IMPROVEMENTS_DIR, kind, file);
  if (existsSync(globalPath)) {
    return {
      suggestionPath: globalPath,
      sidecarDir: path.join(GLOBAL_IMPROVEMENTS_DIR, kind),
      plansDir: path.join(SUPLAGENTICS_HOME, 'plans'),
      buildCwd: SUPLAGENTICS_HOME,
    };
  }
  return null;
}
