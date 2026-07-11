import { z } from 'zod';
import { scanClaudeProjects, opencodeScan } from '../capabilities/import/scan.js';
import { status as dbStatus } from '../capabilities/import/claude-import-db.js';
import { summarizing, pushing, indexerState } from '../capabilities/import/summarize.js';
import { mergeSuggestions, listSuggestions, GLOBAL_IMPROVEMENTS_DIR } from '../capabilities/improvement/suggestions.js';

// Started as phase 1 of the architecture plan (see plans/openchamber-fork-port.md and the
// approved MCP server plan) with just import_scan; grew to cover the rest of the pure-data-access
// half of the moved capability (queue status, suggestion listing). Still deliberately excludes
// anything needing a live opencode HTTP server (delegation-style batch runs) — those callers
// hold the deps this stdio server doesn't have.
export function registerImportTools(server) {
  server.registerTool(
    'suplagentics_import_scan',
    {
      title: 'Scan importable project history',
      description:
        'Scans this machine for opencode session history (from opencode.db) and Claude Code session history (from ~/.claude/projects/) that has not yet been imported into opencode-mem. Returns real per-project session/memory counts and import status — the same data the SuplAgentics dashboard\'s own Import History page shows.',
    },
    async () => {
      const [claude, opencode] = await Promise.all([scanClaudeProjects(), opencodeScan()]);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ claude, opencode }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'suplagentics_import_status',
    {
      title: 'Import/indexing queue status',
      description:
        'Returns the live state of the import indexing pipeline: how many transcript chunks are summarized vs pending, how many imported memory files have been pushed into opencode-mem, and whether the indexer is currently running or stalled (a stall means a full summarizer pass completed without finishing any chunk — usually a failing opencode-mem push or content the model can\'t process). Note: when read via this stdio server the running/stalled flags reflect this process only — the dashboard\'s own pipeline state lives in its server process.',
    },
    async () => {
      const s = await dbStatus();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...s,
              summarizing,
              pushing: pushing.size > 0,
              stalled: indexerState.stalled,
              stalledPending: indexerState.stalledPending,
            }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'suplagentics_improvement_suggestions',
    {
      title: 'List improvement suggestions',
      description:
        'Lists SuplAgentics improvement suggestions (mined from opencode-mem by the insights agents) for a category: skills, agents, or workflows. Given a project directory, returns that project\'s suggestions merged with the global (cross-project) ones; without a directory, returns only the global ones. Each suggestion includes its status (pending/approved/needs-revision/dismissed), scope, and full body.',
      inputSchema: {
        kind: z.enum(['skills', 'agents', 'workflows']).describe('Suggestion category to list'),
        directory: z.string().optional().describe('Absolute project directory to include project-scoped suggestions for'),
      },
    },
    async ({ kind, directory }) => {
      const suggestions = directory
        ? mergeSuggestions(directory, kind)
        : listSuggestions(GLOBAL_IMPROVEMENTS_DIR, kind, 'global');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ kind, suggestions }, null, 2),
          },
        ],
      };
    },
  );
}
