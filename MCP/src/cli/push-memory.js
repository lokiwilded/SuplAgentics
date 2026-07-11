#!/usr/bin/env node
// Thin CLI wrapper around opencode-mem-client.js's postMemory/computeContainerTag — this is what
// the claude-import-summarizer agent's own `bash` tool calls invoke directly (it has no `task`/MCP
// tool access, only bash, by design — see its own frontmatter permission block). Replaces the old
// SuplAgentics stack's `server/lib/opencode-mem-client.js`'s own dual-purpose require.main===module
// CLI entry, at a real, portable, installed-package path instead of a hardcoded personal one.
//
// Usage: node push-memory.js <payload.json>
// where payload.json is { content, projectPath, tags?, type? } — containerTag is computed here
// from projectPath, not supplied by the caller.

import { readFileSync } from 'node:fs';
import { computeContainerTag, postMemory } from '../capabilities/import/opencode-mem-client.js';

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.log(JSON.stringify({ ok: false, error: 'usage: node push-memory.js <payload.json>' }));
  process.exit(1);
}

try {
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
  const { containerTag, projectPath, projectName } = computeContainerTag(payload.projectPath);
  const result = await postMemory({
    content: payload.content, containerTag, tags: payload.tags, type: payload.type,
    projectPath, projectName,
  });
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
}
