// SuplAgentics's Improvement page port — Skills, Agents, and Workflows suggestion categories,
// each with project and global (cross-project synthesis) scopes. Started as a Skills-only slice
// (see plans/openchamber-fork-port.md); generalized once that was verified end-to-end. The
// per-category insights agents (insights-skills/-agents/-workflows) and the global synthesizer
// already existed as real installed agents — this file just stopped hardcoding 'skills'.
//
// The real capability logic (scanning, suggestion file handling, criticmarkup, session
// delegation) now lives in the standalone suplagentics-mcp-server package (see the approved MCP
// server architecture plan) — this file is just the Express adapter: route registration,
// req/res handling, and nothing else. Moving this logic out means the same capability is also
// directly callable by any MCP client (opencode itself, Claude Code, Claude Desktop), not just
// this dashboard.
//
// Unlike the old stack, there's no separate suplagentics-projects.json to cross-reference here —
// OpenChamber already tracks projects itself (useProjectsStore), so the frontend supplies
// whichever directory it wants scanned/investigated directly, matching how plan-routes.js and
// import-routes.js already work in this fork.

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { serializeAnnotations } from 'suplagentics-mcp-server/src/capabilities/improvement/criticmarkup.js';
import { startCommanderSession } from 'suplagentics-mcp-server/src/agent-session-runner.js';
import {
  parseFrontmatter,
  patchStatus,
  countSuggestions,
  mergeSuggestions,
  resolveSuggestionLocation,
  GLOBAL_IMPROVEMENTS_DIR,
} from 'suplagentics-mcp-server/src/capabilities/improvement/suggestions.js';
import {
  latestMemoryTs,
  getTracking,
  runCategoryScan,
  runningScan,
} from 'suplagentics-mcp-server/src/capabilities/improvement/scan.js';

// The three suggestion categories with a real insights-<kind> mining agent installed. A request
// naming anything else is rejected outright — kind lands in file paths and subagent names.
const VALID_KINDS = ['skills', 'agents', 'workflows'];

export function registerSuplagenticsImprovementRoutes(app, { buildOpenCodeUrl, getOpenCodeAuthHeaders }) {
  const deps = { buildOpenCodeUrl, getOpenCodeAuthHeaders };

  app.get('/api/suplagentics/improvement/:kind', async (req, res) => {
    try {
      const kind = req.params.kind;
      if (!VALID_KINDS.includes(kind)) {
        res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
        return;
      }
      const directory = typeof req.query.directory === 'string' ? req.query.directory : '';
      if (!directory) {
        res.status(400).json({ error: 'directory required' });
        return;
      }

      // Auto-trigger: at most one project scan fires per GET, respecting the single-lock
      // invariant even for automatic firing — mirrors the old stack's per-kind cooldown check.
      if (!runningScan.active) {
        const lastAnalyzedAt = getTracking(directory, kind);
        const cooldownMs = 5 * 60 * 1000;
        const latest = await latestMemoryTs(directory);
        if (Date.now() - lastAnalyzedAt > cooldownMs && latest > lastAnalyzedAt) {
          runCategoryScan(deps, kind, 'project', directory, null);
        }
      }

      res.set('Cache-Control', 'no-store');
      res.json({
        suggestions: mergeSuggestions(directory, kind),
        projectCount: countSuggestions(path.join(directory, 'improvements'), kind),
        globalCount: countSuggestions(GLOBAL_IMPROVEMENTS_DIR, kind),
        runningScan,
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/suplagentics/improvement/investigate', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const { scope, directory, allProjectDirectories } = req.body || {};
      // Older clients from the Skills-only slice sent no kind — keep their behavior.
      const kind = req.body?.kind || 'skills';
      if (!VALID_KINDS.includes(kind)) {
        res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
        return;
      }
      if (scope !== 'project' && scope !== 'global') {
        res.status(400).json({ error: 'scope must be "project" or "global"' });
        return;
      }
      if (scope === 'project' && !directory) {
        res.status(400).json({ error: 'directory required for a project-scoped scan' });
        return;
      }
      if (runningScan.active) {
        res.status(409).json({ error: 'another scan is already running' });
        return;
      }
      runCategoryScan(deps, kind, scope, directory, allProjectDirectories);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/suplagentics/improvement/action', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      const { action, directory, file, annotations } = req.body || {};
      const kind = req.body?.kind || 'skills';
      if (!VALID_KINDS.includes(kind)) {
        res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
        return;
      }
      if (!directory || !file || !/^[a-zA-Z0-9_-]+\.md$/.test(file)) {
        res.status(400).json({ error: 'directory and a valid file are required' });
        return;
      }

      const loc = resolveSuggestionLocation(directory, kind, file);
      if (!loc) {
        res.status(404).json({ error: 'suggestion not found' });
        return;
      }
      const { suggestionPath, sidecarDir, plansDir, buildCwd } = loc;

      if (action === 'dismiss') {
        writeFileSync(suggestionPath, patchStatus(readFileSync(suggestionPath, 'utf8'), 'dismissed'), 'utf8');
        res.json({ ok: true });
        return;
      }

      if (action === 'annotate-approve') {
        const content = readFileSync(suggestionPath, 'utf8');
        const { meta, body: planBody } = parseFrontmatter(content);
        writeFileSync(suggestionPath, patchStatus(content, 'approved'), 'utf8');

        const annotationList = Array.isArray(annotations) ? annotations : [];
        const feedbackBlock = annotationList.length > 0 ? `\n\n${serializeAnnotations(annotationList)}\n` : '';

        mkdirSync(plansDir, { recursive: true });
        const planFile = path.join(plansDir, file);
        // Plan file header convention (matches planner/plan-writer output): the absolute project
        // directory and a Session line right under the title, so it's unambiguous which project a
        // plan belongs to and the Build flow can continue/resume the right session. Approved from
        // a suggestion there's no originating session yet, so Session is the em-dash placeholder —
        // the Build flow fills it in when it starts one.
        const header = `# ${meta.title || file.replace('.md', '')}\n\n**Project:** \`${buildCwd}\`\n**Session:** \`—\`\n`;
        writeFileSync(planFile, `${header}${planBody}${feedbackBlock}`, 'utf8');

        res.json({ ok: true, plan: `plans/${file}` });
        return;
      }

      if (action === 'annotate-deny') {
        const annotationList = Array.isArray(annotations) ? annotations : [];
        if (annotationList.length === 0) {
          res.status(400).json({ error: 'annotations required to deny with feedback' });
          return;
        }
        const content = readFileSync(suggestionPath, 'utf8');
        writeFileSync(suggestionPath, patchStatus(content, 'needs-revision'), 'utf8');

        const sidecarPath = path.join(sidecarDir, file.replace('.md', '.discussion.json'));
        let sidecar = { messages: [] };
        try { sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')); } catch { /* first feedback for this suggestion */ }
        sidecar.messages.push({ role: 'user', at: new Date().toISOString(), feedback: serializeAnnotations(annotationList), annotations: annotationList });
        writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8');

        res.json({ ok: true });
        return;
      }

      if (action === 'build') {
        const planFile = path.join(plansDir, file);
        if (!existsSync(planFile)) {
          res.status(400).json({ error: 'approve this suggestion first — no plan file found' });
          return;
        }
        // A real commander session, not a one-shot terminal — OpenChamber has a genuine chat UI
        // (the old headless dashboard didn't), so the user can watch this happen in Chat directly.
        const result = await startCommanderSession({
          ...deps,
          directory: buildCwd,
          title: `Build: ${file.replace('.md', '')}`,
          prompt: `Execute the approved plan at plans/${file}`,
        });
        if (!result.ok) {
          res.status(502).json({ error: 'Failed to start the build session' });
          return;
        }
        res.json({ ok: true, sessionId: result.sessionId });
        return;
      }

      res.status(400).json({ error: 'unknown action' });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });
}
