// First-run installer — makes a fresh `suplagentics` install actually behave like SuplAgentics,
// not stock OpenChamber. Adapted from the old standalone SuplAgentics CLI's own `cmdInstall()`
// (C:\Users\lokid\dev\SuplAgentics\bin\suplagentics.js at the time this was written) — same
// file-copy/merge safeguards (skip-if-exists for agent files so a friend's own edits survive
// future updates, always-overwrite for the 3 core plugin .ts files so bug fixes do propagate,
// additive-only opencode.json merge that never touches a key the user already set), minus the
// old CLI's interactive terminal prompts — a web dashboard has no TTY to prompt in, and
// provider/model choice already has a real home in OpenChamber's own Providers/Agents pages.
//
// Defaults to the Ollama Cloud provider (matching templates/opencode.json's own default) —
// whoever installs this can change models afterward via the Agents/Providers settings pages,
// same as any other OpenChamber user would.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const MCP_SERVER_NAME = 'suplagentics';

// Resolves the real, installed suplagentics-mcp-server package path on THIS machine — the same
// resolution lifecycle.js uses to set $SUPLAGENTICS_MCP_SERVER_DIR for agent bash calls. Reused
// here so the MCP entry we register points at wherever npm/bun actually put the package, never a
// hardcoded path.
function resolveSuplagenticsMcpServerEntrypoint() {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('suplagentics-mcp-server/package.json');
    return path.join(path.dirname(pkgJsonPath), 'src', 'index.js');
  } catch {
    return null;
  }
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');
const AGENTS_DIR = path.join(CONFIG_DIR, 'agents');
const PLUGIN_DIR = path.join(CONFIG_DIR, 'plugin');
const OPENCODE_JSON_PATH = path.join(CONFIG_DIR, 'opencode.json');
const OPENCODE_MEM_JSONC_PATH = path.join(CONFIG_DIR, 'opencode-mem.jsonc');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'suplagentics-settings.json');
const MANIFEST_PATH = path.join(CONFIG_DIR, 'suplagentics-manifest.json');

// Real npm packages the curated agent set depends on — same list as the old CLI's own
// `requiredPlugins`/`packages` (kept in sync deliberately; this is the "core SuplAgentics"
// set, not whatever a user's own live opencode.json has grown to include over time).
const REQUIRED_NPM_PACKAGES = [
  'opencode-mem',
  '@tarquinen/opencode-dcp',
  '@ramtinj95/opencode-tokenscope',
  'opencode-synced',
  'opencode-queue',
  '@ai-sdk/openai-compatible',
  '@atonev/opencode-short-term-memory',
  'cc-safety-net',
  'envsitter-guard',
  'opencode-log-sanitizer',
  'opencode-skill-creator',
];

const REQUIRED_PLUGIN_ENTRIES = [
  ...REQUIRED_NPM_PACKAGES,
  './plugin/suplagentics-cache.ts',
  './plugin/suplagentics-rag.ts',
  './plugin/suplagentics-compact.ts',
];

function buildMemConfig() {
  return {
    embeddingApiUrl: 'http://127.0.0.1:11434/v1',
    embeddingApiKey: 'ollama',
    embeddingModel: 'bge-m3',
    memoryProvider: 'openai-chat',
    memoryApiUrl: 'https://ollama.com/v1',
    memoryApiKey: 'env://OLLAMA_API_KEY',
    memoryModel: 'deepseek-v4-flash',
    memoryTemperature: 0.3,
    opencodeProvider: 'ollama-cloud',
    opencodeModel: 'deepseek-v4-flash',
    webServerEnabled: true,
    webServerPort: 4747,
    webServerHost: '127.0.0.1',
    autoCaptureEnabled: true,
    autoCaptureMaxIterations: 5,
    autoCaptureMaxRetries: 3,
    deduplicationEnabled: true,
    deduplicationSimilarityThreshold: 0.90,
    autoCleanupEnabled: true,
    autoCleanupRetentionDays: 30,
  };
}

export function isSuplagenticsInstalled() {
  return existsSync(MANIFEST_PATH);
}

// onProgress(step: string) — called before each real step so the caller can show live status,
// matching the progress-bar pattern already used for the Agents bulk-toggle (a slow, multi-step
// action deserves visible feedback, not a silent black box).
//
// mcpDeps is optional (createMcpConfig, getMcpConfig, refreshOpenCodeAfterConfigChange) — supplied
// by setup-routes.js from OpenChamber's own real MCP config functions (the exact same ones its
// own MCP Settings page uses), so this registers the server the same way a user manually adding
// it through that page would, additively and at `user` scope (global — every project, no
// per-project step, confirmed live earlier this session). Optional because a bare capability
// caller (e.g. a future CLI-only installer) might not have OpenChamber's own config functions
// available — the rest of installation still succeeds without it, just without live MCP
// registration; a message is reported so the caller knows to sort it out.
export async function ensureSuplagenticsInstalled({ templatesDir, onProgress, mcpDeps } = {}) {
  const report = (step) => { if (onProgress) onProgress(step); };
  const createdFiles = [];
  const addedPlugins = [];

  mkdirSync(CONFIG_DIR, { recursive: true });

  // Back up opencode.json before any change — only once, matching the old CLI's guard.
  const backupPath = path.join(CONFIG_DIR, 'opencode.json.suplagentics.bak');
  const backedUp = [];
  if (existsSync(OPENCODE_JSON_PATH) && !existsSync(backupPath)) {
    report('Backing up existing opencode.json…');
    copyFileSync(OPENCODE_JSON_PATH, backupPath);
    backedUp.push('opencode.json');
  }

  // Copy the 3 core plugin .ts files — always overwrite (these ship bug fixes over time).
  report('Installing plugin files…');
  mkdirSync(PLUGIN_DIR, { recursive: true });
  const pluginSrcDir = path.join(templatesDir, 'plugins');
  for (const f of readdirSync(pluginSrcDir)) {
    copyFileSync(path.join(pluginSrcDir, f), path.join(PLUGIN_DIR, f));
    createdFiles.push(`plugin/${f}`);
  }

  // Copy agent .md files — skip if already present, so a friend's own edits survive updates.
  // Source is split into agents/ (top-level) and subagents/ (the mode: subagent ones) purely for
  // readability; opencode reads them from one flat dir, so both are flattened into AGENTS_DIR.
  report('Installing agent files…');
  mkdirSync(AGENTS_DIR, { recursive: true });
  for (const sub of ['agents', 'subagents']) {
    const agentSrcDir = path.join(templatesDir, sub);
    if (!existsSync(agentSrcDir)) continue;
    for (const f of readdirSync(agentSrcDir)) {
      const dest = path.join(AGENTS_DIR, f);
      if (existsSync(dest)) continue;
      copyFileSync(path.join(agentSrcDir, f), dest);
      createdFiles.push(`agents/${f}`);
    }
  }

  // Merge opencode.json additively — never touches a key the user already set.
  report('Configuring opencode.json…');
  let ocConfig = {};
  if (existsSync(OPENCODE_JSON_PATH)) {
    try { ocConfig = JSON.parse(readFileSync(OPENCODE_JSON_PATH, 'utf8')); } catch { /* corrupt/empty — treat as fresh */ }
  }
  if (!ocConfig.provider) ocConfig.provider = {};
  if (!ocConfig.provider['ollama-cloud']) {
    const tmpl = JSON.parse(readFileSync(path.join(templatesDir, 'opencode.json'), 'utf8'));
    ocConfig.provider['ollama-cloud'] = tmpl.provider['ollama-cloud'];
  }
  if (!ocConfig.model) ocConfig.model = 'ollama-cloud/glm-5.2';
  if (!ocConfig.small_model) ocConfig.small_model = 'ollama-cloud/deepseek-v4-flash';
  if (!ocConfig.default_agent) ocConfig.default_agent = 'commander';
  if (!Array.isArray(ocConfig.plugin)) ocConfig.plugin = [];
  for (const p of REQUIRED_PLUGIN_ENTRIES) {
    if (!ocConfig.plugin.includes(p)) {
      ocConfig.plugin.push(p);
      addedPlugins.push(p);
    }
  }
  writeFileSync(OPENCODE_JSON_PATH, JSON.stringify(ocConfig, null, 2) + '\n', 'utf8');

  // opencode-mem.jsonc — skip if already present.
  if (!existsSync(OPENCODE_MEM_JSONC_PATH)) {
    report('Writing opencode-mem.jsonc…');
    writeFileSync(OPENCODE_MEM_JSONC_PATH, JSON.stringify(buildMemConfig(), null, 2) + '\n', 'utf8');
    createdFiles.push('opencode-mem.jsonc');
  }

  // suplagentics-settings.json — skip if already present.
  if (!existsSync(SETTINGS_PATH)) {
    report('Writing suplagentics-settings.json…');
    copyFileSync(path.join(templatesDir, 'suplagentics-settings.json'), SETTINGS_PATH);
    createdFiles.push('suplagentics-settings.json');
  }

  // The one genuinely slow, network-dependent step — skip entirely if it looks already done, so
  // this doesn't re-run a 10-60s npm install on every subsequent call.
  const alreadyHasPlugins = REQUIRED_NPM_PACKAGES.every(p => existsSync(path.join(CONFIG_DIR, 'node_modules', p)));
  if (!alreadyHasPlugins) {
    report(`Installing ${REQUIRED_NPM_PACKAGES.length} opencode plugin packages (this can take a minute)…`);
    try {
      execSync(`npm install ${REQUIRED_NPM_PACKAGES.join(' ')}`, { cwd: CONFIG_DIR, stdio: 'ignore' });
    } catch (error) {
      // Non-fatal — the agent/config files are still in place; the user can run this manually.
      report(`npm install failed (${error?.message || 'unknown error'}) — run manually: cd "${CONFIG_DIR}" && npm install ${REQUIRED_NPM_PACKAGES.join(' ')}`);
    }
  }

  // Register the standalone MCP server at user scope (global — every project) via OpenChamber's
  // own real MCP config functions, exactly as if the user had added it themselves through the
  // MCP Settings page. Skipped (not overwritten) if an entry with this name already exists —
  // the user may have customized it, or already re-registered it themselves.
  let mcpRegistered = false;
  if (mcpDeps?.createMcpConfig && mcpDeps?.getMcpConfig) {
    const entrypoint = resolveSuplagenticsMcpServerEntrypoint();
    if (!entrypoint) {
      report('Could not locate the suplagentics-mcp-server package on disk — skipping MCP registration.');
    } else {
      const existing = mcpDeps.getMcpConfig(MCP_SERVER_NAME, null);
      if (existing) {
        report('MCP server already registered — leaving it as configured.');
      } else {
        report('Registering the SuplAgentics MCP server with opencode…');
        try {
          mcpDeps.createMcpConfig(MCP_SERVER_NAME, {
            type: 'local',
            command: ['node', entrypoint],
            enabled: true,
          }, null, 'user');
          mcpRegistered = true;
        } catch (error) {
          report(`Failed to register the MCP server (${error?.message || 'unknown error'}) — you can add it manually on the MCP settings page.`);
        }
      }
    }
  }

  // Restarting opencode so it actually picks up everything written above (the MCP entry
  // especially — opencode only reads its config at startup) — only worth doing if we changed
  // something opencode would care about; skip entirely on a no-op re-run.
  if (mcpDeps?.refreshOpenCodeAfterConfigChange && (mcpRegistered || createdFiles.length > 0 || addedPlugins.length > 0)) {
    report('Restarting opencode to pick up the new configuration…');
    try {
      await mcpDeps.refreshOpenCodeAfterConfigChange('suplagentics install');
    } catch (error) {
      report(`opencode restart failed (${error?.message || 'unknown error'}) — restart it yourself to pick up the new config.`);
    }
  }

  report('Writing install manifest…');
  writeFileSync(MANIFEST_PATH, JSON.stringify({
    installedAt: new Date().toISOString(),
    backedUp,
    createdFiles,
    addedPlugins,
    npmPackages: REQUIRED_NPM_PACKAGES,
  }, null, 2) + '\n', 'utf8');

  return { ok: true, backedUp, createdFiles, addedPlugins };
}
