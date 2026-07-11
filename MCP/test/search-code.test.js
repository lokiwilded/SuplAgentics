// Runtime regression test for suplagentics_search_code (P0). The handler once referenced
// `reindexedCount` / `reindexStaleInBackground` (defined nowhere) and threw ReferenceError on every
// call — yet `node --check` and the unit tests passed. This drives the real MCP server end to end
// (mock Ollama, isolated HOME) so a runtime fault fails the suite, not just a syntax error.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_DIR = fileURLToPath(new URL('..', import.meta.url));
const embed = (t) => { const v = new Array(8).fill(0); for (let i = 0; i < t.length; i++) v[i % 8] += t.charCodeAt(i) / 255; return v; };

test('search_code returns scored results end to end (no ReferenceError)', { timeout: 20000 }, async () => {
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'bge-m3' }] })); }
      if (req.url.startsWith('/api/embeddings')) { const { prompt } = JSON.parse(body || '{}'); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ embedding: embed(prompt || '') })); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const home = mkdtempSync(join(tmpdir(), 'sc-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'sc-ws-'));
  writeFileSync(join(ws, 'auth.js'), 'export function validateToken(t){ return typeof t==="string" && t.length>10; }\n');
  writeFileSync(join(ws, 'db.js'), 'export function query(sql){ return conn.prepare(sql).all(); }\n');

  const env = { ...process.env, HOME: home, USERPROFILE: home, OLLAMA_URL: `http://127.0.0.1:${port}`, SUPLAGENTICS_EMBED_MODEL: 'bge-m3' };
  const mcp = spawn('node', ['src/index.js'], { cwd: MCP_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  mcp.stdout.on('data', (d) => (out += d));
  const send = (o) => mcp.stdin.write(JSON.stringify(o) + '\n');

  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'suplagentics_index_workspace', arguments: { directory: ws, force: true } } });
    await new Promise((r) => setTimeout(r, 1500));
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'suplagentics_search_code', arguments: { query: 'how is the auth token validated', directory: ws } } });
    await new Promise((r) => setTimeout(r, 2500));

    const msgs = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const search = msgs.find((m) => m.id === 3);
    assert.ok(search, 'no response to search_code');
    assert.ok(!search.error, `search_code errored: ${JSON.stringify(search.error)}`);
    const text = search.result?.content?.[0]?.text ?? '';
    assert.match(text, /score:/, `expected scored results, got: ${text.slice(0, 160)}`);
  } finally {
    mcp.kill();
    srv.close();
  }
});
