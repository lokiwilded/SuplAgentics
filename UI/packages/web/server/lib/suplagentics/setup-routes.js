// First-run setup — detects whether this machine has ever had SuplAgentics's agent files/config
// installed, and exposes the one action that does it (see installer.js for what "installed"
// actually means and why it's structured the way it is).

import path from 'node:path';
import { enforceSameOrigin } from './api-security.js';
import { fileURLToPath } from 'node:url';
import { isSuplagenticsInstalled, ensureSuplagenticsInstalled } from './installer.js';

// The opencode scaffolding (agents, subagents, skills, plugins, base config) is its own package —
// suplagentics-opencode (the D:\SuplAgentics\OC folder). The installer copies it into
// ~/.config/opencode. Resolve it through the package (via its package.json) so it works from the
// bun-copied dependency, and stays correct if this package is ever published/installed elsewhere.
const TEMPLATES_DIR = path.dirname(fileURLToPath(import.meta.resolve('suplagentics-opencode/package.json')));

let installState = { active: false, step: '', error: null };

export function registerSuplagenticsSetupRoutes(app, { createMcpConfig, getMcpConfig, refreshOpenCodeAfterConfigChange } = {}) {
  const mcpDeps = { createMcpConfig, getMcpConfig, refreshOpenCodeAfterConfigChange };

  app.get('/api/suplagentics/setup/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ installed: isSuplagenticsInstalled(), ...installState });
  });

  app.post('/api/suplagentics/setup/install', enforceSameOrigin, async (req, res) => {
    if (installState.active) {
      res.status(409).json({ error: 'install already running' });
      return;
    }
    installState = { active: true, step: 'Starting…', error: null };
    res.json({ ok: true, started: true });

    try {
      await ensureSuplagenticsInstalled({
        templatesDir: TEMPLATES_DIR,
        onProgress: (step) => { installState = { ...installState, step }; },
        mcpDeps,
      });
      installState = { active: false, step: 'Done', error: null };
    } catch (error) {
      installState = { active: false, step: '', error: error?.message || String(error) };
    }
  });
}
