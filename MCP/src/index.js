#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerImportTools } from './tools/import-tools.js';
import { registerRagTools } from './tools/rag-tools.js';
import { registerCacheTools } from './tools/cache-tools.js';
import { registerGuardTools } from './tools/guard-tools.js';
import { closeDb } from './capabilities/import/claude-import-db.js';

const VERSION = '0.1.0';
const START = Date.now();
const server = new McpServer({ name: 'suplagentics', version: VERSION });

registerImportTools(server);
registerRagTools(server);
registerCacheTools(server);
registerGuardTools(server);

// Liveness probe — lets the dashboard and audits confirm the server is up and which version is
// running, without invoking a heavier tool.
server.registerTool(
  'suplagentics_health',
  { title: 'MCP server health', description: 'Report that the SuplAgentics MCP server is alive.', inputSchema: {} },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, version: VERSION, uptime_s: Math.round((Date.now() - START) / 1000) }) }],
  }),
);

// Checkpoint the import-queue WAL and exit cleanly on shutdown (B-12). closeDb() is async — await
// it so the checkpoint completes before the process goes away. Guard against double-fire.
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await closeDb(); } catch { /* best effort — shutting down regardless */ } finally { process.exit(0); }
  });
}

// Report startup failures to stderr instead of dying with an unhandled rejection (A-2).
try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (err) {
  console.error(`[suplagentics] MCP server failed to start: ${err?.stack || err}`);
  process.exit(1);
}
