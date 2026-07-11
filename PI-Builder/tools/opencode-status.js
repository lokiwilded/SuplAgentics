#!/usr/bin/env node
// opencode-status — READ-ONLY health/activity check of the running SuplAgentics stack
// (dashboard + opencode server + MCP). Non-disruptive: it only reads the opencode log,
// queries the OS process list, and does a GET on /global/health. It never writes, never
// restarts, and never sends a model request — safe to run against a live, busy system.
//
// Usage:
//   node tools/opencode-status.js          human summary
//   node tools/opencode-status.js --json    machine-readable (for the PI-Fixer agent)
//   node tools/opencode-status.js --watch    re-run every 5s until Ctrl-C
//   node tools/opencode-status.js --watch 10 re-run every 10s
import { openSync, fstatSync, readSync, closeSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[34m', d: '\x1b[2m', x: '\x1b[0m', bold: '\x1b[1m' };
const JSON_OUT = process.argv.includes('--json');
const WATCH = process.argv.includes('--watch');
const watchArg = process.argv[process.argv.indexOf('--watch') + 1];
const WATCH_SEC = Math.max(2, Number.parseInt(watchArg, 10) || 5);

const LOG = path.join(homedir(), '.local', 'share', 'opencode', 'log', 'opencode.log');
const RESTART_LOG = path.join(homedir(), '.local', 'share', 'opencode', 'log', 'openchamber-restarts.log');
const DASHBOARD_PORT = Number.parseInt(process.env.OPENCHAMBER_PORT || '3910', 10);

// ---- helpers ---------------------------------------------------------------
function tailFile(file, maxBytes = 262144) {
  if (!existsSync(file)) return '';
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function httpProbe(port, pathname = '/global/health', timeout = 3000) {
  return new Promise((resolve) => {
    if (!port) return resolve({ alive: false, reason: 'no-port' });
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout }, (res) => {
      res.resume();
      // 401 = server is up but wants the auth header; still "alive".
      resolve({ alive: true, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ alive: false, reason: 'timeout' }); });
    req.on('error', (e) => resolve({ alive: false, reason: e.code || e.message }));
  });
}

function tcpProbe(port, timeout = 2000) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const s = net.connect({ host: '127.0.0.1', port });
    s.setTimeout(timeout);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

function getProcesses() {
  try {
    if (process.platform === 'win32') {
      const psCmd =
        "Get-CimInstance Win32_Process -Filter \"Name='opencode.exe' or Name='bun.exe' or Name='node.exe'\" " +
        "| Select-Object ProcessId,Name,ParentProcessId,CommandLine,@{n='StartEpochMs';e={[int64]([datetimeoffset]$_.CreationDate).ToUnixTimeMilliseconds()}} " +
        '| ConvertTo-Json -Depth 3';
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        encoding: 'utf8', timeout: 10000, windowsHide: true,
      });
      let parsed = JSON.parse(out || 'null');
      if (!parsed) return [];
      if (!Array.isArray(parsed)) parsed = [parsed];
      return parsed.map((p) => ({
        pid: p.ProcessId, name: p.Name, ppid: p.ParentProcessId,
        cmd: p.CommandLine || '', startMs: p.StartEpochMs || null,
      }));
    }
    // posix fallback
    const out = execFileSync('ps', ['-eo', 'pid,ppid,lstart,args'], { encoding: 'utf8' });
    return out.split('\n').slice(1).map((line) => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/);
      if (!m) return null;
      return { pid: +m[1], ppid: +m[2], name: '', cmd: m[4], startMs: Date.parse(m[3]) || null };
    }).filter(Boolean).filter((p) => /opencode|bun|node/.test(p.cmd));
  } catch {
    return [];
  }
}

const portOf = (cmd) => {
  const m = /--port\s+(\d+)/.exec(cmd || '');
  return m ? Number.parseInt(m[1], 10) : null;
};
const ageStr = (ms) => {
  if (ms == null) return '?';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

// ---- log analysis ----------------------------------------------------------
function analyzeLog() {
  const text = tailFile(LOG);
  const lines = text.split('\n').filter(Boolean);
  const tsOf = (l) => { const m = /timestamp=([^\s]+Z)/.exec(l); return m ? Date.parse(m[1]) : null; };

  let lastTs = null, lastActivityTs = null, lastActivityKind = null;
  let lastStream = null; // { ts, model, session, agent }
  let lastLoop = null;   // { ts, session, step }
  let lastBootTs = null;
  const boots = [];
  const errors = [];

  for (const l of lines) {
    const ts = tsOf(l);
    if (ts && (!lastTs || ts > lastTs)) lastTs = ts;

    if (l.includes('message="creating instance"')) { if (ts) { boots.push(ts); lastBootTs = ts; } }

    if (l.includes('message=stream ')) {
      const model = /modelID=([^\s]+)/.exec(l)?.[1];
      const session = /session\.id=([^\s]+)/.exec(l)?.[1];
      const agent = /agent=([^\s]+)/.exec(l)?.[1];
      lastStream = { ts, model, session, agent };
      if (ts && (!lastActivityTs || ts > lastActivityTs)) { lastActivityTs = ts; lastActivityKind = 'stream'; }
    }
    if (l.includes('message=loop ')) {
      const session = /session\.id=([^\s]+)/.exec(l)?.[1];
      const step = /step=(\d+)/.exec(l)?.[1];
      lastLoop = { ts, session, step };
      if (ts && (!lastActivityTs || ts > lastActivityTs)) { lastActivityTs = ts; lastActivityKind = 'loop'; }
    }
    if (l.includes('message=process session')) {
      if (ts && (!lastActivityTs || ts > lastActivityTs)) { lastActivityTs = ts; lastActivityKind = 'process'; }
    }
    if (l.includes('level=ERROR')) {
      const msg = /message=("[^"]*"|[^\s]+)/.exec(l)?.[1]?.replace(/^"|"$/g, '');
      errors.push({ ts, msg });
    }
  }

  const recentBoots = boots.filter((t) => Date.now() - t < 60 * 60 * 1000); // last hour
  const recentErrors = errors.filter((e) => e.ts && Date.now() - e.ts < 15 * 60 * 1000);

  return { lastTs, lastActivityTs, lastActivityKind, lastStream, lastLoop, lastBootTs, recentBoots, errors: recentErrors };
}

// The dashboard writes one line per health-monitor-triggered opencode restart here (added to
// UI/packages/web/server/lib/opencode/lifecycle.js). This is the authoritative "why did it
// restart" record — the opencode log only shows the *new* process booting, not the cause.
function analyzeRestarts() {
  const text = tailFile(RESTART_LOG, 32768);
  if (!text) return { total: 0, lastHour: 0, last: null };
  const rows = text.split('\n').filter(Boolean).map((l) => {
    const ts = Date.parse((/^(\S+)/.exec(l) || [])[1]);
    const reason = (/reason=(\S+)/.exec(l) || [])[1] || '?';
    const active = (/activeSessions=(\d+)/.exec(l) || [])[1];
    return { ts, reason, active };
  }).filter((r) => Number.isFinite(r.ts));
  const lastHour = rows.filter((r) => Date.now() - r.ts < 60 * 60 * 1000);
  const last = rows[rows.length - 1] || null;
  return { total: rows.length, lastHour: lastHour.length, last };
}

// ---- assemble --------------------------------------------------------------
async function collect() {
  const procs = getProcesses();
  const opencode = procs.find((p) => /opencode\.exe$/i.test(p.name) || /opencode.*\bserve\b/.test(p.cmd)) || null;
  const dashboard = procs.find((p) => /packages[\\/]web[\\/]server/.test(p.cmd) || /start\.mjs/.test(p.cmd)) || null;
  const mcps = procs.filter((p) => /MCP[\\/]src[\\/]index\.js/.test(p.cmd));

  const ocPort = opencode ? portOf(opencode.cmd) : null;
  const health = opencode ? await httpProbe(ocPort) : { alive: false, reason: 'no-process' };
  const dashPort = dashboard ? (portOf(dashboard.cmd) || DASHBOARD_PORT) : DASHBOARD_PORT;
  const dashUp = dashboard ? await tcpProbe(dashPort) : false;

  const log = analyzeLog();
  const restarts = analyzeRestarts();

  // ---- verdict ----
  const activityAge = log.lastActivityTs ? (Date.now() - log.lastActivityTs) / 1000 : Infinity;
  let state, verdict;
  if (!opencode) {
    state = 'DOWN';
    verdict = 'opencode server process is NOT running. The dashboard should respawn it — if it does not, restart the dashboard.';
  } else if (!health.alive) {
    state = 'WEDGED';
    verdict = `opencode process is alive (PID ${opencode.pid}) but not answering on port ${ocPort ?? '?'} (${health.reason}). It may be mid-boot or wedged.`;
  } else if (activityAge < 120) {
    state = 'ACTIVE';
    const s = log.lastStream, lp = log.lastLoop;
    verdict = `Working. ${s ? `${s.agent} streaming ${s.model}` : lastActivityKindLabel(log)}` +
      `${lp ? `, session ${short(lp.session)} step ${lp.step}` : ''}, last activity ${ageStr(log.lastActivityTs)}.`;
  } else if (log.lastStream && log.lastActivityKind === 'stream' && activityAge >= 120) {
    state = 'HUNG';
    verdict = `Possible HUNG stream — ${log.lastStream.model} for ${log.lastStream.agent} (session ${short(log.lastStream.session)}) opened ${ageStr(log.lastStream.ts)} with no follow-up. The model may be stalled; cancel the turn and retry.`;
  } else {
    const justBooted = log.lastBootTs && (Date.now() - log.lastBootTs < 20 * 60 * 1000);
    state = dashUp ? 'IDLE-STALE-UI' : 'IDLE';
    const bootNote = justBooted ? ` Server (re)booted ${ageStr(log.lastBootTs)}.` : '';
    const uiNote = dashUp
      ? ' If the dashboard shows a spinner it is STALE (the server is doing nothing) — refresh the tab and re-send your last message.'
      : '';
    verdict = `No session running (last activity ${log.lastActivityTs ? ageStr(log.lastActivityTs) : 'unknown'}).${bootNote}${uiNote}`;
  }

  // Prefer the authoritative breadcrumb (reason-tagged) over the boot-count heuristic.
  let restartWarn = null;
  if (restarts.lastHour >= 3) {
    const r = restarts.last;
    restartWarn = `health-monitor restarted opencode ${restarts.lastHour}x in the last hour` +
      `${r ? ` (last: ${r.reason}, ${r.active} active session(s), ${ageStr(r.ts)})` : ''}. ` +
      'Raise OPENCHAMBER_OPENCODE_STALE_BUSY_GRACE_MS / health timeout, or check for crashes.';
  } else if (restarts.total === 0 && log.recentBoots.length >= 3) {
    restartWarn = `opencode booted ${log.recentBoots.length}x in the last hour but no health-monitor restarts were recorded — cause is external (HMR, crash, or manual), not the health check.`;
  }

  return {
    state, verdict, restartWarn,
    opencode: opencode && { pid: opencode.pid, port: ocPort, uptime: ageStr(opencode.startMs), health: health.alive ? (health.status || 'ok') : health.reason },
    dashboard: { up: dashUp, port: dashPort, pid: dashboard?.pid ?? null },
    mcp: mcps.map((m) => ({ pid: m.pid, uptime: ageStr(m.startMs) })),
    restarts: { lastHour: restarts.lastHour, total: restarts.total, last: restarts.last && { reason: restarts.last.reason, active: restarts.last.active, age: ageStr(restarts.last.ts) } },
    log: {
      lastActivity: log.lastActivityTs ? ageStr(log.lastActivityTs) : null,
      lastActivityKind: log.lastActivityKind,
      lastStream: log.lastStream && { model: log.lastStream.model, agent: log.lastStream.agent, session: short(log.lastStream.session), age: ageStr(log.lastStream.ts) },
      recentBoots: log.recentBoots.length,
      recentErrors: log.errors.slice(-3).map((e) => e.msg),
    },
  };
}
function short(id) { return id ? id.slice(0, 14) : id; }
function lastActivityKindLabel(log) { return log.lastActivityKind || 'processing'; }

// ---- render ----------------------------------------------------------------
function render(r) {
  const dot = { ACTIVE: c.g, IDLE: c.d, 'IDLE-STALE-UI': c.y, HUNG: c.r, WEDGED: c.r, DOWN: c.r }[r.state] || c.d;
  console.log(`\n${c.bold}${c.b}SuplAgentics / opencode — Status${c.x}\n`);
  console.log(`  ${dot}${c.bold}● ${r.state}${c.x} — ${r.verdict}\n`);

  console.log(`  ${c.bold}Dashboard${c.x}   ${r.dashboard.up ? c.g + 'up' : c.r + 'down'}${c.x} ${c.d}:${r.dashboard.port}${r.dashboard.pid ? ` pid ${r.dashboard.pid}` : ''}${c.x}`);
  if (r.opencode) {
    console.log(`  ${c.bold}opencode${c.x}    ${c.g}pid ${r.opencode.pid}${c.x} ${c.d}:${r.opencode.port} · up ${r.opencode.uptime} · health ${r.opencode.health}${c.x}`);
  } else {
    console.log(`  ${c.bold}opencode${c.x}    ${c.r}not running${c.x}`);
  }
  console.log(`  ${c.bold}MCP${c.x}         ${r.mcp.length ? r.mcp.map((m) => `pid ${m.pid} (${m.uptime})`).join(', ') : c.d + 'none' + c.x}`);
  if (r.mcp.length > 1) console.log(`              ${c.y}${r.mcp.length} suplagentics MCP instances — usually 1; extra is opencode's project+global split (benign unless DB locks appear)${c.x}`);
  if (r.restarts) {
    const rl = r.restarts.last;
    const col = r.restarts.lastHour >= 3 ? c.y : c.d;
    console.log(`  ${c.bold}Restarts${c.x}    ${col}${r.restarts.lastHour} in last hour${c.x}${rl ? c.d + ` · last: ${rl.reason} (${rl.active} active, ${rl.age})` + c.x : c.d + ' · none recorded' + c.x}`);
  }

  console.log(`\n  ${c.bold}Last activity${c.x} ${r.log.lastActivity || c.d + 'none in tail' + c.x}${r.log.lastActivityKind ? c.d + ` (${r.log.lastActivityKind})` + c.x : ''}`);
  if (r.log.lastStream) console.log(`  ${c.d}Last stream:  ${r.log.lastStream.agent} · ${r.log.lastStream.model} · ${r.log.lastStream.age}${c.x}`);
  if (r.log.recentErrors.length) {
    console.log(`  ${c.r}Recent errors (15m):${c.x}`);
    for (const e of r.log.recentErrors) console.log(`    ${c.r}- ${e}${c.x}`);
  }
  if (r.restartWarn) console.log(`\n  ${c.y}⚠ ${r.restartWarn}${c.x}`);
  console.log();
}

// ---- main ------------------------------------------------------------------
async function once() {
  const r = await collect();
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2));
  else render(r);
  return r;
}

if (WATCH && !JSON_OUT) {
  const loop = async () => {
    process.stdout.write('\x1b[2J\x1b[H'); // clear
    await once();
    console.log(`${c.d}watching — refresh every ${WATCH_SEC}s — Ctrl-C to stop${c.x}`);
  };
  await loop();
  setInterval(loop, WATCH_SEC * 1000);
} else {
  await once();
}
