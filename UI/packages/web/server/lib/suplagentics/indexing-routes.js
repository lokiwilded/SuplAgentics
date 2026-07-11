// SuplAgentics's Indexing settings — configuration and control surface for the pipeline that
// turns imported session history into memories (chunk queue → claude-import-summarizer →
// opencode-mem push) and for the insights agents that mine those memories for suggestions.
//
// Deliberately reuses OpenChamber's own built-in agent config machinery (getAgentConfig/
// updateAgent — the exact functions behind PATCH /api/config/agents/:name) instead of a parallel
// frontmatter patcher: the summarizer/insights models ARE agent frontmatter `model:` fields, so
// changing them here behaves byte-identically to editing those agents on the Agents page.
//
// The queue/stall state itself lives in the suplagentics-mcp-server package (see
// capabilities/import/summarize.js's indexerState comment for the stall story) — this file is
// just the Express adapter, same pattern as import-routes.js/improvement-routes.js.

import express from 'express';
import { status as dbStatus } from 'suplagentics-mcp-server/src/capabilities/import/claude-import-db.js';
import {
  spawnSummarizerBatch,
  processMemoryPushQueue,
  summarizing,
  pushing,
  indexerState,
  clearIndexerStall,
} from 'suplagentics-mcp-server/src/capabilities/import/summarize.js';
import { getAgentConfig, updateAgent } from '../opencode/agents.js';

const SUMMARIZER_AGENT = 'claude-import-summarizer';
// The whole insights family shares one "insights model" setting — they're the same mining
// workload (read opencode-mem, write suggestion .md files), just scoped per category.
const INSIGHTS_AGENTS = [
  'insights',
  'insights-skills',
  'insights-agents',
  'insights-workflows',
  'insights-ecosystem',
  'insights-global-synthesizer',
  'insights-consolidator',
];

function readAgentModel(agentName) {
  try {
    const { config } = getAgentConfig(agentName, undefined);
    return typeof config.model === 'string' ? config.model : '';
  } catch {
    return '';
  }
}

export function registerSuplagenticsIndexingRoutes(app, { buildOpenCodeUrl, getOpenCodeAuthHeaders, refreshOpenCodeAfterConfigChange }) {
  const opencodeDeps = { buildOpenCodeUrl, getOpenCodeAuthHeaders };

  app.get('/api/suplagentics/indexing', async (req, res) => {
    try {
      const s = await dbStatus();
      res.set('Cache-Control', 'no-store');
      res.json({
        status: {
          ...s,
          summarizing,
          pushing: pushing.size > 0,
          stalled: indexerState.stalled,
          stalledPending: indexerState.stalledPending,
        },
        summarizerModel: readAgentModel(SUMMARIZER_AGENT),
        // insights-skills is the family member project scans actually invoke — representative
        // of the whole family (saving below patches every member to the same model anyway).
        insightsModel: readAgentModel('insights-skills'),
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  // Explicit user-triggered (re)start of the pipeline — the only way a stalled queue resumes
  // (the status route's automatic resume-on-view deliberately skips stalled queues, see
  // import-routes.js).
  app.post('/api/suplagentics/indexing/run', async (req, res) => {
    try {
      const s = await dbStatus();
      clearIndexerStall();
      if (s.chunksPending > 0 && !summarizing) spawnSummarizerBatch(opencodeDeps);
      if (s.memoryFilesPushPending > 0 && pushing.size === 0) processMemoryPushQueue();
      res.json({ ok: true, chunksPending: s.chunksPending, memoryFilesPushPending: s.memoryFilesPushPending });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.put('/api/suplagentics/indexing/models', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const { summarizerModel, insightsModel } = req.body || {};
      const updated = [];
      if (typeof summarizerModel === 'string' && summarizerModel.trim()) {
        updateAgent(SUMMARIZER_AGENT, { model: summarizerModel.trim() }, undefined);
        updated.push(SUMMARIZER_AGENT);
      }
      if (typeof insightsModel === 'string' && insightsModel.trim()) {
        for (const name of INSIGHTS_AGENTS) {
          // A family member that doesn't exist on this install (someone deleted it) just gets
          // skipped — updateAgent would otherwise create a stray override file for it.
          const { source } = getAgentConfig(name, undefined);
          if (source === 'none') continue;
          updateAgent(name, { model: insightsModel.trim() }, undefined);
          updated.push(name);
        }
      }
      if (updated.length === 0) {
        res.status(400).json({ error: 'summarizerModel or insightsModel required' });
        return;
      }
      await refreshOpenCodeAfterConfigChange('suplagentics indexing model update');
      res.json({ ok: true, updated });
    } catch (error) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });
}
