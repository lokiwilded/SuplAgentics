// PI-Builder — SuplAgentics extension for Pi.
//
// Gives PI-Fixer first-class tools to (a) mine SuplAgentics' opencode conversations and
// (b) run the propagation-safe fix workflow. The live opencode.db is read READ-ONLY via
// node:sqlite (Node 26 builtin; falls back to MCP's bundled better-sqlite3). We NEVER write
// to the live DB. Secrets are redacted before any transcript reaches the model or the corpus.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

const require = createRequire(import.meta.url);

const HOME = os.homedir();
const SUPAGENTICS_ROOT = process.env.SUPAGENTICS_ROOT || "D:/SuplAgentics";
const SYNC_SELF = path.join(SUPAGENTICS_ROOT, "sync-self.mjs");
const AUDIT_SCANNER = path.join(process.cwd(), "tools", "audit-scanner.js");
const OPENCODE_DB = path.join(HOME, ".local", "share", "opencode", "opencode.db");
const PROJECTS_JSON = path.join(HOME, ".config", "opencode", "suplagentics-projects.json");
const CORPUS_DIR = path.join(process.cwd(), ".pi", "corpus");

// A project's conversations live at one path; its fixes must land at another. SuplAgentics
// history was recorded at C:\...\dev\SuplAgentics before the repo was repointed to D:\SuplAgentics.
const FIX_ROOT_ALIASES: Record<string, string> = {
  "C:/Users/lokid/dev/SuplAgentics": SUPAGENTICS_ROOT,
};
const DEFAULT_CONVO_DIR = "C:/Users/lokid/dev/SuplAgentics";

const norm = (p: string) => (p || "").replace(/\\/g, "/");
const fixRootFor = (dir: string) => FIX_ROOT_ALIASES[norm(dir)] || norm(dir);
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const fmt = (ms: number) => new Date(Number(ms)).toISOString().slice(0, 16).replace("T", " ");

function redact(s: string): string {
  if (!s) return s;
  return s
    .replace(/\b[A-Za-z0-9]{20,}\.[A-Za-z0-9]{20,}\b/g, "‹redacted-key›")
    .replace(/\b(sk-|xox[baprs]-|ghp_|gho_|glpat-)[A-Za-z0-9_\-]{10,}/g, "‹redacted-token›")
    .replace(/("?(?:api[_-]?key|apikey|token|secret|password|authorization|bearer)"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1‹redacted›");
}

type DB = { prepare: (sql: string) => { all: (...a: any[]) => any[]; get: (...a: any[]) => any } };
function openDb(): DB {
  try {
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(OPENCODE_DB, { readOnly: true }) as unknown as DB;
  } catch {
    const Database = require(path.join(SUPAGENTICS_ROOT, "MCP", "node_modules", "better-sqlite3"));
    return new Database(OPENCODE_DB, { readonly: true, fileMustExist: true }) as DB;
  }
}

function readProjects(): Array<{ id: string; name: string; directory: string; notes: string }> {
  try {
    const j = JSON.parse(fs.readFileSync(PROJECTS_JSON, "utf8"));
    return (j.projects || []).map((p: any) => ({ id: p.id, name: p.name, directory: norm(p.directory), notes: p.notes || "" }));
  } catch { return []; }
}

function resolveProjectDir(project?: string): { name: string; directory: string } {
  if (!project) return { name: "SuplAgentics", directory: DEFAULT_CONVO_DIR };
  const projs = readProjects();
  const byName = projs.find((p) => p.name.toLowerCase() === project.toLowerCase());
  if (byName) return { name: byName.name, directory: byName.directory };
  const byDir = projs.find((p) => p.directory === norm(project));
  if (byDir) return { name: byDir.name, directory: byDir.directory };
  if (project.includes("/") || project.includes("\\")) return { name: project, directory: norm(project) };
  return { name: project, directory: DEFAULT_CONVO_DIR };
}

function recentSessions(db: DB, dir: string, limit: number) {
  return db.prepare(
    "SELECT id, title, directory, time_updated, summary_files FROM session " +
    "WHERE directory = ? AND parent_id IS NULL ORDER BY time_updated DESC LIMIT ?"
  ).all(dir, limit);
}

// Reconstruct a readable, redacted transcript and flag tool errors (the 'clear issues').
function transcript(db: DB, sessionId: string, maxTurns: number) {
  const msgs = db.prepare("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC").all(sessionId);
  const turns: Array<{ role: string; text: string }> = [];
  const issues: Array<{ tool: string; status: string; detail: string }> = [];
  for (const m of msgs) {
    let md: any = {}; try { md = JSON.parse(m.data); } catch {}
    const parts = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC").all(m.id);
    const chunks: string[] = [];
    for (const p of parts) {
      let pd: any; try { pd = JSON.parse(p.data); } catch { continue; }
      if (pd.type === "text" && pd.text && !pd.synthetic) chunks.push(pd.text);
      else if (pd.type === "tool" && pd.state) {
        const st = String(pd.state.status || "");
        const blob = String(pd.state.error ?? pd.state.output ?? "");
        if (st === "error" || /(^|\b)(error|failed|denied|invalid|exception)\b/i.test(blob)) {
          issues.push({ tool: pd.tool || "?", status: st || "error", detail: blob.slice(0, 300) });
        }
        chunks.push(`⟦tool ${pd.tool} → ${st || "?"}⟧`);
      }
    }
    const text = chunks.join("\n").trim();
    if (text) turns.push({ role: md.role || "?", text });
  }
  const shown = turns.slice(-maxTurns);
  const body = shown.map((t) => `### ${t.role}\n${redact(t.text)}`).join("\n\n");
  return { turnCount: turns.length, shown: shown.length, issues, body };
}

export default function (pi: ExtensionAPI) {
  const out = (t: string, details?: any) => ({ content: [{ type: "text", text: t }], ...(details ? { details } : {}) });

  pi.registerTool({
    name: "supl_projects",
    label: "SuplAgentics projects",
    description: "List the projects tracked by the SuplAgentics dashboard (name, directory, notes). Use for the conversation-based work picker and to resolve @project mentions.",
    parameters: Type.Object({}),
    async execute() {
      const projs = readProjects();
      if (!projs.length) return out("No projects found (missing suplagentics-projects.json).");
      const lines = projs.map((p) => `- ${p.name} — ${p.directory}${p.notes ? `\n    notes: ${p.notes.slice(0, 160)}` : ""}`);
      return out(`Tracked projects:\n${lines.join("\n")}`, { projects: projs });
    },
  });

  pi.registerTool({
    name: "supl_sessions",
    label: "Recent sessions",
    description: "List recent top-level opencode sessions for a project (title + timestamp). Defaults to SuplAgentics history. Backs /work and /recent.",
    parameters: Type.Object({
      project: Type.Optional(Type.String({ description: "Project name or a directory. Omit for SuplAgentics." })),
      limit: Type.Optional(Type.Number({ description: "How many (default 8, max 30)." })),
    }),
    async execute(_id: string, params: any) {
      const { name, directory } = resolveProjectDir(params.project);
      const limit = Math.min(Math.max(params.limit || 8, 1), 30);
      const rows = recentSessions(openDb(), directory, limit);
      if (!rows.length) return out(`No sessions found for ${name} (${directory}).`);
      const lines = rows.map((r: any) => `- [${r.id}] ${fmt(r.time_updated)} — ${r.title || "(untitled)"}${r.summary_files ? `  (${r.summary_files} files)` : ""}`);
      return out(`Recent sessions for ${name}:\n${lines.join("\n")}`, { project: name, directory, fixRoot: fixRootFor(directory), sessions: rows });
    },
  });

  pi.registerTool({
    name: "supl_session",
    label: "Read session",
    description: "Load a redacted transcript of one opencode session by id and flag the tool errors/failures that happened in it. Use to review a session for clear issues before deciding what to improve.",
    parameters: Type.Object({
      id: Type.String({ description: "Session id (ses_...)." }),
      maxTurns: Type.Optional(Type.Number({ description: "Max turns (default 40, max 200)." })),
    }),
    async execute(_id: string, params: any) {
      const t = transcript(openDb(), params.id, Math.min(Math.max(params.maxTurns || 40, 4), 200));
      const head = `Session ${params.id} — ${t.turnCount} turns (showing last ${t.shown}).`;
      const issueBlock = t.issues.length
        ? `\n\n⚠️ ${t.issues.length} tool issue(s):\n` + t.issues.slice(0, 12).map((i) => `- ${i.tool} → ${i.status}: ${redact(i.detail)}`).join("\n")
        : "\n\nNo tool errors detected.";
      return out(`${head}${issueBlock}\n\n---\n${t.body}`, { issues: t.issues, turnCount: t.turnCount });
    },
  });

  pi.registerTool({
    name: "supl_project",
    label: "Project context (@mention)",
    description: "Pull a project's notes + recent sessions into context. Use when the user references @<projectname> in general mode (e.g. 'in @Freedom45 I had ...').",
    parameters: Type.Object({ name: Type.String({ description: "Project name." }) }),
    async execute(_id: string, params: any) {
      const projs = readProjects();
      const p = projs.find((x) => x.name.toLowerCase() === params.name.toLowerCase());
      if (!p) return out(`Unknown project '${params.name}'. Known: ${projs.map((x) => x.name).join(", ")}`);
      const rows = recentSessions(openDb(), p.directory, 8);
      const sess = rows.map((r: any) => `- [${r.id}] ${fmt(r.time_updated)} — ${r.title || "(untitled)"}`).join("\n") || "(no sessions)";
      return out(`@${p.name} — ${p.directory}\n${p.notes ? `Notes: ${p.notes}\n` : ""}\nRecent sessions:\n${sess}`, { project: p, sessions: rows });
    },
  });

  pi.registerTool({
    name: "supl_archive",
    label: "Archive convos",
    description: "Export a project's opencode sessions to a redacted local mining corpus at .pi/corpus/<project>.jsonl. Never touches the live DB. Run once to give PI-Fixer a clean corpus decoupled from the messy live opencode.db.",
    parameters: Type.Object({
      project: Type.Optional(Type.String({ description: "Project name/dir. Omit for SuplAgentics." })),
      maxSessions: Type.Optional(Type.Number({ description: "Cap (default 300, max 2000)." })),
    }),
    async execute(_id: string, params: any, _signal: any, onUpdate: any) {
      const { name, directory } = resolveProjectDir(params.project);
      const cap = Math.min(Math.max(params.maxSessions || 300, 1), 2000);
      const db = openDb();
      const sessions = db.prepare(
        "SELECT id, title, time_updated FROM session WHERE directory = ? AND parent_id IS NULL ORDER BY time_updated DESC LIMIT ?"
      ).all(directory, cap);
      fs.mkdirSync(CORPUS_DIR, { recursive: true });
      const file = path.join(CORPUS_DIR, `${name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}.jsonl`);
      const stream = fs.createWriteStream(file, { encoding: "utf8" });
      let n = 0, withIssues = 0;
      for (const s of sessions) {
        const t = transcript(db, s.id, 500);
        if (t.issues.length) withIssues++;
        stream.write(JSON.stringify({ id: s.id, title: s.title, at: fmt(s.time_updated), turns: t.turnCount, issues: t.issues, body: t.body }) + "\n");
        if (++n % 25 === 0) onUpdate?.({ content: [{ type: "text", text: `archived ${n}/${sessions.length}...` }] });
      }
      stream.end();
      return out(`Archived ${n} '${name}' sessions → ${path.relative(process.cwd(), file)} (${withIssues} had tool issues).`, { file, count: n, withIssues });
    },
  });

  // ---- propagation tools: exec the repo's own robust sync-self.mjs (readdirSync-based, LF-safe) ----
  async function runNode(args: string[], timeout = 180000) {
    const r = await pi.exec("node", args, { timeout });
    return stripAnsi(`${r.stdout || ""}${r.stderr ? "\n" + r.stderr : ""}`).trim() || `(exit ${r.code})`;
  }

  pi.registerTool({
    name: "supl_scan",
    label: "Scan self-audit",
    description: "Cross-reference SuplAgentics' self-audit (plans/self-audit.md) with live code and list open findings (P0/P1/...).",
    parameters: Type.Object({}),
    async execute() { return out(await runNode([AUDIT_SCANNER])); },
  });

  pi.registerTool({
    name: "supl_diff",
    label: "Check drift (propagation verifier)",
    description: "Dry-run push to show whether repo OC/ differs from the live ~/.config/opencode. 'already in sync' means a fix HAS propagated. ALWAYS run after a fix to confirm it reached the running system.",
    parameters: Type.Object({}),
    async execute() { return out("repo → live (dry run):\n" + await runNode([SYNC_SELF, "push", "--dry"])); },
  });

  pi.registerTool({
    name: "supl_sync",
    label: "Sync repo↔live",
    description: "Propagate config between repo and live opencode. push = repo→live (apply a fix). pull = live→repo (capture drift). opencode must be restarted to load changes.",
    parameters: Type.Object({ mode: StringEnum(["push", "pull"] as const), dry: Type.Optional(Type.Boolean()) }),
    async execute(_id: string, params: any) {
      const args = [SYNC_SELF, params.mode]; if (params.dry) args.push("--dry");
      return out(await runNode(args));
    },
  });

  pi.registerTool({
    name: "supl_refresh",
    label: "Refresh (push + dashboard)",
    description: "Full propagation: push repo→live, then refresh the dashboard bun cache (+ rebuild). After this, restart opencode AND the dashboard for changes to load.",
    parameters: Type.Object({ build: Type.Optional(Type.Boolean({ description: "Rebuild React dist (needed for UI/route changes). Default true." })) }),
    async execute(_id: string, params: any) {
      const push = await runNode([SYNC_SELF, "push"]);
      const dashArgs = [SYNC_SELF, "dash"]; if (params.build !== false) dashArgs.push("--build");
      const dash = await runNode(dashArgs, 600000);
      return out(`${push}\n\n${dash}\n\n⟳ Restart opencode (loads agents/plugins) and the dashboard (node start.mjs).`);
    },
  });
}
