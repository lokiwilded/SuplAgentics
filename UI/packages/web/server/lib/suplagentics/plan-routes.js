// SuplAgentics's Plans+annotator port (plans/openchamber-fork-port.md). OpenChamber's own native
// Plans panel (packages/ui/src/components/session/ProjectNotesTodoPanel.tsx) already stores plan
// files at <project>/plans/*.md — the exact convention SuplAgentics's own session-based Plans
// feature already uses. This route adds only what OpenChamber doesn't have: sending structured
// review feedback (CriticMarkup, same technique as SuplAgentics's own server/routes/plans.js) back
// to the live opencode session that's actually working on a given plan.

import express from 'express';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { serializeAnnotations } from './criticmarkup.js';
import { describeSketch } from './vision-describe.js';
import { openDb } from './sqlite-runtime.js';
import { enforceSameOrigin } from './api-security.js';

const OPENCODE_DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const SUPLAGENTICS_PLANS_PATH = path.join(os.homedir(), '.config', 'opencode', 'suplagentics-plans.json');

// Verified live (see plans/openchamber-fork-port.md): OpenChamber's own managed opencode instance
// writes to this exact same shared opencode.db as any other opencode invocation — it's not a
// per-launcher location. This is the most reliable way to find "the session that created this
// plan": rather than needing the agent to self-report its session id (fragile — easy to forget,
// nothing enforces it), or trusting whichever session the reviewer happens to have open right now
// (can be wrong — the user might review a plan from a totally different conversation), read what
// actually happened: which session's write-capable tool call touched this exact file most
// recently, verified live to include delegated subagent writes (planner often hands the actual
// write off to a plan-writer/coder subagent via `task`, whose own session is a child of the one
// the user is really talking to) — so the result is walked up to its root ancestor session.
// Escape SQL LIKE wildcards (%, _) in filenames used in LIKE patterns
function escapeLike(str) { return str.replace(/[%_]/g, (m) => '\\' + m); }


// Path validation — prevent path traversal in plan/improvement routes
function isPathWithin(childPath, parentPath) {
  const resolved = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  return resolved.startsWith(parent + path.sep) || resolved === parent;
}

async function findCreatingSessionForPlanPath(planFilePath) {
  if (!existsSync(OPENCODE_DB_PATH)) return null;
  const targetName = escapeLike(path.basename(planFilePath));
  const db = await openDb(OPENCODE_DB_PATH, { readonly: true });
  try {
    const rows = db.all(`
      SELECT p.session_id, s.parent_id
      FROM part p JOIN session s ON s.id = p.session_id
      WHERE json_extract(p.data,'$.type') = 'tool'
        AND json_extract(p.data,'$.tool') IN ('bash', 'write', 'edit')
        AND json_extract(p.data,'$.state.input') LIKE ? ESCAPE '\'
      ORDER BY p.time_created DESC
      LIMIT 1
    `, `%${targetName}%`);
    if (rows.length === 0) return null;

    let sessionId = rows[0].session_id;
    let parentId = rows[0].parent_id;
    const seen = new Set();
    while (parentId && !seen.has(sessionId)) {
      seen.add(sessionId);
      const parentRow = db.get('SELECT id, parent_id FROM session WHERE id = ?', parentId);
      if (!parentRow) break;
      sessionId = parentRow.id;
      parentId = parentRow.parent_id;
    }
    return sessionId;
  } catch (error) {
    console.error('findCreatingSessionForPlanPath failed:', error);
    return null;
  } finally {
    db.close();
  }
}

async function readSuplagenticsPlans() {
  try {
    const raw = await readFile(SUPLAGENTICS_PLANS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeSuplagenticsPlans(data) {
  await mkdir(path.dirname(SUPLAGENTICS_PLANS_PATH), { recursive: true });
  await writeFile(SUPLAGENTICS_PLANS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Records a newly-created review session against a plan file so a SECOND round of feedback on
// the same file (e.g. the reviewer annotates again after getting a response) finds it via the
// tracking-file lookup tier, instead of hitting this same "no session found" gap every time.
async function trackPlanSession(directory, planFilePath, sessionId) {
  const plansData = await readSuplagenticsPlans();
  if (!plansData.projects || typeof plansData.projects !== 'object') plansData.projects = {};
  const key = directory || '__unknown__';
  if (!Array.isArray(plansData.projects[key])) plansData.projects[key] = [];
  plansData.projects[key].push({ file: planFilePath, sessionId, createdAt: new Date().toISOString() });
  await writeSuplagenticsPlans(plansData);
}

// No session in opencode.db's own history and no tracking-file record means this plan file
// didn't originate from a live SuplAgentics planning session at all — e.g. a suggestion approved
// straight from the Improvement page, or a plan file dropped in manually (an imported Obsidian
// note, someone else's plan file copied over). Rather than failing outright, start a genuine
// review conversation for it now: a real session, agent: planner (the dedicated open-ended
// planning-conversation agent — see CLAUDE.md's own note on why not commander), told to read the
// existing plan file first since — unlike a normal new plan — this session didn't write it.
async function createReviewSessionForOrphanPlan({ buildOpenCodeUrl, getOpenCodeAuthHeaders, directory, planPath, feedback }) {
  const sessionUrl = new URL(buildOpenCodeUrl('/session', ''));
  if (directory) sessionUrl.searchParams.set('directory', directory);
  const sessionRes = await fetch(sessionUrl.toString(), {
    method: 'POST',
    headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ agent: 'planner', title: `Plan review: ${path.basename(planPath)}` }),
  });
  if (!sessionRes.ok) return { ok: false };
  const session = await sessionRes.json();

  const promptUrl = new URL(buildOpenCodeUrl(`/session/${encodeURIComponent(session.id)}/prompt_async`, ''));
  if (directory) promptUrl.searchParams.set('directory', directory);
  const promptRes = await fetch(promptUrl.toString(), {
    method: 'POST',
    headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      parts: [{
        type: 'text',
        text: `You're picking up review of an existing plan at ${planPath} that this session did not originally write — read it first to understand its full content, then address the following review feedback:\n\n${feedback}`,
      }],
    }),
  });
  if (!promptRes.ok) return { ok: false };

  return { ok: true, sessionId: session.id };
}

// suplagentics-plans.json's real shape is { projects: { <projectKey>: [ {planId, file,
// sessionId, ...}, ... ] } } — grouped per project, not a flat map of records. Matched by
// basename, not full path — SuplAgentics's own tracking stores a path relative to wherever it
// resolved that project's directory, which may not byte-for-byte match how this fork resolves the
// same project's absolute plans/ directory.
function findSessionIdInSuplagenticsTracking(plansData, planFilePath) {
  // Plain exact-match comparison below (===), NOT a SQL LIKE — so escapeLike must NOT be applied here
  // (it would turn `my_plan.md` into `my\_plan.md` and never match). Use the raw basename.
  const targetName = path.basename(planFilePath);
  const projects = plansData?.projects && typeof plansData.projects === 'object' ? plansData.projects : {};
  for (const records of Object.values(projects)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (record?.file && path.basename(record.file) === targetName) {
        return record.sessionId || null;
      }
    }
  }
  return null;
}

// The session a plan came from is stamped into the plan file itself as an HTML comment at the
// bottom (invisible in rendered markdown, and after the body so it never disturbs the `# heading`
// the Plans panel reads as the title). This is the durable, user-visible-in-the-file record the
// user asked for — it survives even if opencode.db's own history gets pruned, unlike the
// derive-from-tool-calls path. The UI strips this marker before showing the plan in the annotator.
const SESSION_MARKER_RE = /\n*<!--\s*suplagentics-session:\s*(\S+)\s*-->\s*$/;

function parseSessionMarker(raw) {
  const m = typeof raw === 'string' ? raw.match(SESSION_MARKER_RE) : null;
  return m ? m[1] : null;
}

async function stampSessionMarker(planFilePath, sessionId) {
  try {
    let content = await readFile(planFilePath, 'utf8');
    content = content.replace(SESSION_MARKER_RE, '').replace(/\s+$/, '');
    content += `\n\n<!-- suplagentics-session: ${sessionId} -->\n`;
    await writeFile(planFilePath, content, 'utf8');
  } catch (error) {
    // A stamp failure must never block the build itself — the session is still resolvable from
    // history/tracking next time; log and move on.
    console.error('stampSessionMarker failed:', error);
  }
}

// "if its still there" — a session id resolved from a stamp or tracking file can point at a chat
// the user has since deleted/archived. Only a live, non-archived session is a valid continuation
// target; anything else means "start a new one".
async function sessionIsAlive(sessionId) {
  if (!sessionId || !existsSync(OPENCODE_DB_PATH)) return false;
  const db = await openDb(OPENCODE_DB_PATH, { readonly: true });
  try {
    const row = db.get('SELECT id, time_archived FROM session WHERE id = ?', sessionId);
    return !!row && !row.time_archived;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

// Resolve the plan's origin session, most-authoritative first: (1) the marker stamped in the file,
// (2) opencode's own tool-call history (derives the real writer, walked to its root ancestor),
// (3) SuplAgentics's tracking file. Returns the id even if the session is now dead — the caller
// checks liveness separately so it can decide continue-vs-new.
async function resolveOriginSession(planFilePath) {
  let raw = '';
  try { raw = await readFile(planFilePath, 'utf8'); } catch { /* file may not be readable */ }
  return (
    parseSessionMarker(raw)
    || await findCreatingSessionForPlanPath(planFilePath)
    || findSessionIdInSuplagenticsTracking(await readSuplagenticsPlans(), planFilePath)
    || null
  );
}

async function startBuildSession({ buildOpenCodeUrl, getOpenCodeAuthHeaders, directory, planBasename }) {
  const sessionUrl = new URL(buildOpenCodeUrl('/session', ''));
  if (directory) sessionUrl.searchParams.set('directory', directory);
  const sessionRes = await fetch(sessionUrl.toString(), {
    method: 'POST',
    headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ agent: 'commander', title: `Build: ${planBasename.replace(/\.md$/, '')}` }),
  });
  if (!sessionRes.ok) return null;
  return (await sessionRes.json()).id;
}

async function sendBuildPrompt({ buildOpenCodeUrl, getOpenCodeAuthHeaders, directory, sessionId, planBasename }) {
  const promptUrl = new URL(buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}/prompt_async`, ''));
  if (directory) promptUrl.searchParams.set('directory', directory);
  const res = await fetch(promptUrl.toString(), {
    method: 'POST',
    headers: { ...getOpenCodeAuthHeaders(), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      parts: [{
        type: 'text',
        text: `The plan at plans/${planBasename} has been approved — build it now. Read plans/${planBasename} first for the full content, implement it end to end, then run the reviewer as usual. When the build is fully complete and reviewed, stamp the plan as done: set (or add) a \`**Completed:** \`<current ISO 8601 timestamp>\`\` line directly under the \`**Session:**\` line near the top of plans/${planBasename}, changing nothing else in the file — this is what marks it Completed in the dashboard's Plans panel.`,
      }],
    }),
  });
  return res.ok;
}

// Writes one sketch PNG (image/png data URL) next to its plan, in a `<plan-basename>.sketches/`
// sibling dir so it's git-tracked with the plan. Returns the saved absolute path, or null if the
// data URL is malformed.
async function saveSketchPng(planPath, id, dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  const dir = path.join(path.dirname(planPath), `${path.basename(planPath, '.md')}.sketches`);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.png`);
  await writeFile(filePath, Buffer.from(m[1], 'base64'));
  return filePath;
}

// A `sketch` annotation carries a drawn PNG the text-only planner can't see. Convert each into a
// normal anchored `comment` (which the existing CriticMarkup serializer already handles): save the
// PNG beside the plan, have the vision model describe it, and put that description plus the saved
// path into the comment — dropping the heavy data URL so it never reaches the session. Non-sketch
// annotations pass through untouched. Runs sketches concurrently; a describe/save failure degrades
// to a note that a sketch exists rather than losing the annotation.
async function resolveSketchAnnotations(planPath, annotations) {
  return Promise.all(annotations.map(async (ann) => {
    if (ann?.type !== 'sketch' || typeof ann.sketch !== 'string') return ann;
    let savedPath = null;
    try { savedPath = await saveSketchPng(planPath, ann.id, ann.sketch); } catch { savedPath = null; }
    const description = await describeSketch(ann.sketch);
    const relPath = savedPath
      ? path.relative(path.dirname(planPath), savedPath).split(path.sep).join('/')
      : null;
    const comment = description
      ? `A UI sketch was drawn for this section. Vision description of the sketch:\n${description}${relPath ? `\n\n(Sketch image saved at ${relPath} — read it if you need the exact visual.)` : ''}`
      : `A UI sketch was drawn for this section${relPath ? ` and saved at ${relPath}` : ''}, but it could not be auto-described — read the saved image to see what was drawn.`;
    const { sketch: _sketch, ...rest } = ann;
    return { ...rest, type: 'comment', comment };
  }));
}

// Frame backing sizes, mirrored from the UI's FRAME_SIZES (WireframeDesigner.tsx) — used only to
// annotate the serialized element tree with each frame's dimensions so the planner knows the canvas.
const FRAME_DIMS = {
  desktop: { w: 1280, h: 800, label: 'Desktop' },
  tabletLandscape: { w: 1024, h: 768, label: 'Tablet landscape' },
  tabletPortrait: { w: 768, h: 1024, label: 'Tablet portrait' },
  phonePortrait: { w: 390, h: 844, label: 'Phone portrait' },
};

// Save one clean wireframe render (image/png data URL) beside its plan, in the same
// `<plan-basename>.sketches/` sibling dir sketches use. Returns the saved absolute path, or null.
async function saveRenderPng(planPath, id, frame, dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  const dir = path.join(path.dirname(planPath), `${path.basename(planPath, '.md')}.sketches`);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}-${frame}.png`);
  await writeFile(filePath, Buffer.from(m[1], 'base64'));
  return filePath;
}

// Serialize a WireframeSpec into a deterministic markdown block the text-only planner reads as
// authoritative — each element's kind, label, per-frame geometry, and element-anchored notes. This
// (not the image) is the source of truth for element intent; the clean renders are visual backup.
function serializeWireframeSpec(spec, savedRelPaths) {
  const lines = [];
  const frames = Array.isArray(spec.frames) ? spec.frames : [];
  const frameDesc = frames
    .map((f) => { const d = FRAME_DIMS[f]; return d ? `${d.label} ${d.w}×${d.h}` : f; })
    .join(', ');
  lines.push(`Frames: ${frameDesc || 'none'}`);
  lines.push('Elements:');
  for (const el of Array.isArray(spec.elements) ? spec.elements : []) {
    const geom = frames
      .map((f) => {
        const r = el.rect?.[f];
        return r ? `${f} x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.w)} h=${Math.round(r.h)}` : null;
      })
      .filter(Boolean)
      .join('; ');
    lines.push(`- [${el.kind}] "${el.label || ''}"${geom ? ` @ ${geom}` : ''}`);
    for (const note of Array.isArray(el.comments) ? el.comments : []) {
      if (typeof note === 'string' && note.trim()) lines.push(`    - note: ${note.trim()}`);
    }
  }
  if (savedRelPaths.length > 0) {
    lines.push('Clean wireframe renders saved at (read for exact visuals):');
    for (const { frame, relPath } of savedRelPaths) lines.push(`- ${frame}: ${relPath}`);
  }
  return lines.join('\n');
}

// An `element` annotation carries a structured wireframe the text-only planner can't see. Like
// resolveSketchAnnotations, convert each into an anchored `comment`: save the clean per-frame PNGs
// beside the plan, serialize the element tree as authoritative text, and add a vision description of
// the primary render as a backup — dropping the heavy data URLs so they never reach the session.
async function resolveElementAnnotations(planPath, annotations) {
  return Promise.all(annotations.map(async (ann) => {
    if (ann?.type !== 'element' || !ann.element || typeof ann.element !== 'object') return ann;
    const spec = ann.element;
    const frames = Array.isArray(spec.frames) ? spec.frames : [];
    const renders = spec.renders && typeof spec.renders === 'object' ? spec.renders : {};

    const savedRelPaths = [];
    let primaryRender = null;
    for (const frame of frames) {
      const dataUrl = renders[frame];
      if (typeof dataUrl !== 'string') continue;
      if (!primaryRender) primaryRender = dataUrl;
      let savedPath = null;
      try { savedPath = await saveRenderPng(planPath, ann.id, frame, dataUrl); } catch { savedPath = null; }
      if (savedPath) {
        savedRelPaths.push({ frame, relPath: path.relative(path.dirname(planPath), savedPath).split(path.sep).join('/') });
      }
    }

    const tree = serializeWireframeSpec(spec, savedRelPaths);
    const description = primaryRender ? await describeSketch(primaryRender) : null;
    const comment = `A UI wireframe was designed for this section — treat the structured element tree below as authoritative over any image.\n\n${tree}${description ? `\n\nVision description of the wireframe render (visual backup):\n${description}` : ''}`;
    const { element: _element, ...rest } = ann;
    return { ...rest, type: 'comment', comment };
  }));
}

export function registerSuplagenticsPlanRoutes(app, { buildOpenCodeUrl, getOpenCodeAuthHeaders }) {
  // 8mb (up from 256kb): sketch annotations embed image/png data URLs, several of which can add up.
  app.post('/api/suplagentics/plans/feedback', enforceSameOrigin, express.json({ limit: '8mb' }), async (req, res) => {
    try {
      const { path: planPath, annotations, directory, sessionId: requestedSessionId } = req.body || {};
      if (typeof planPath !== 'string' || !planPath.trim() || !Array.isArray(annotations)) {
        res.status(400).json({ error: 'path and annotations are required' });
        return;
      }

      // Path validation — must be an absolute .md under a project's plans/ dir, on ANY drive.
      // Projects live on C:/D:/Z:, so the old homeDir-only check rejected D:\<project>\plans (e.g.
      // Freedom45 on D:) — that's what broke "send for review". Same guard the annotation routes use.
      if (!isValidPlanPath(planPath)) {
        res.status(403).json({ error: 'path must be an absolute .md file under a plans/ directory' });
        return;
      }

      // Sketches + wireframes -> described/serialized comments before CriticMarkup serialization
      // (see resolveSketchAnnotations / resolveElementAnnotations). Order is independent — each
      // pass only touches its own annotation type and leaves the rest untouched.
      const withSketches = await resolveSketchAnnotations(planPath, annotations);
      const resolvedAnnotations = await resolveElementAnnotations(planPath, withSketches);
      const feedback = serializeAnnotations(resolvedAnnotations);
      const normalizedDirectory = typeof directory === 'string' && directory.trim() ? directory.trim() : null;

      // Priority: (1) derive the actual creating session from opencode's own tool-call history —
      // the most literal reading of "the chat that created it," verified live, requires no
      // cooperation from the agent; (2) SuplAgentics's own side-channel tracking file, for cases
      // the history-derived lookup can't resolve (e.g. an old plan predating this mechanism); (3)
      // whichever session the frontend says is currently open, as a last resort only — it can be
      // the wrong conversation if the reviewer isn't currently in the one that wrote this plan.
      let sessionId = await findCreatingSessionForPlanPath(planPath);
      if (!sessionId) {
        const plansData = await readSuplagenticsPlans();
        sessionId = findSessionIdInSuplagenticsTracking(plansData, planPath);
      }
      if (!sessionId && typeof requestedSessionId === 'string' && requestedSessionId.trim()) {
        sessionId = requestedSessionId.trim();
      }

      // No session anywhere — this plan file didn't come from a live SuplAgentics planning
      // conversation at all (a suggestion approved straight from Improvement, a manually-dropped
      // file, an imported note from elsewhere). Rather than failing, start a real review session
      // for it now, so this still works for someone importing plans from outside sources.
      if (!sessionId) {
        const created = await createReviewSessionForOrphanPlan({
          buildOpenCodeUrl, getOpenCodeAuthHeaders, directory: normalizedDirectory, planPath, feedback,
        });
        if (!created.ok) {
          res.status(502).json({ error: 'Failed to start a new review session for this plan' });
          return;
        }
        await trackPlanSession(normalizedDirectory, planPath, created.sessionId);
        res.json({ ok: true, sessionId: created.sessionId, startedNewSession: true });
        return;
      }

      const promptUrl = new URL(buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}/prompt_async`, ''));
      if (normalizedDirectory) {
        promptUrl.searchParams.set('directory', normalizedDirectory);
      }

      const response = await fetch(promptUrl.toString(), {
        method: 'POST',
        headers: {
          ...getOpenCodeAuthHeaders(),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ parts: [{ type: 'text', text: feedback }] }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        res.status(502).json({ error: `Failed to send feedback to session (${response.status})${body ? `: ${body}` : ''}` });
        return;
      }

      res.json({ ok: true, sessionId });
    } catch (error) {
      console.error('Failed to send plan feedback:', error);
      res.status(500).json({ error: error?.message || 'Failed to send plan feedback' });
    }
  });

  // Approve & Build: implement the plan, continuing the same session it came from if that chat is
  // still alive, otherwise a fresh commander session. Either way the resolved session id is
  // stamped back into the plan file so the next action stays in the same conversation.
  app.post('/api/suplagentics/plans/build', enforceSameOrigin, express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const { path: planPath, directory } = req.body || {};
      if (typeof planPath !== 'string' || !planPath.trim()) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      const normalizedDirectory = typeof directory === 'string' && directory.trim() ? directory.trim() : null;
      const planBasename = path.basename(planPath);

      const originSession = await resolveOriginSession(planPath);
      const continueExisting = await sessionIsAlive(originSession);

      let sessionId = originSession;
      let continued = false;
      if (continueExisting) {
        const ok = await sendBuildPrompt({ buildOpenCodeUrl, getOpenCodeAuthHeaders, directory: normalizedDirectory, sessionId, planBasename });
        if (!ok) {
          res.status(502).json({ error: 'Failed to send the build to the existing session' });
          return;
        }
        continued = true;
      } else {
        sessionId = await startBuildSession({ buildOpenCodeUrl, getOpenCodeAuthHeaders, directory: normalizedDirectory, planBasename });
        if (!sessionId) {
          res.status(502).json({ error: 'Failed to start a build session' });
          return;
        }
        const ok = await sendBuildPrompt({ buildOpenCodeUrl, getOpenCodeAuthHeaders, directory: normalizedDirectory, sessionId, planBasename });
        if (!ok) {
          res.status(502).json({ error: 'Failed to send the build prompt' });
          return;
        }
      }

      await stampSessionMarker(planPath, sessionId);
      await trackPlanSession(normalizedDirectory, planPath, sessionId);
      res.json({ ok: true, sessionId, continued });
    } catch (error) {
      console.error('Failed to build plan:', error);
      res.status(500).json({ error: error?.message || 'Failed to build plan' });
    }
  });

  // --- Annotation persistence (cross-device) ---
  // Draft annotations are stored in a .annotations.json sidecar next to the plan file so they
  // survive across devices (localStorage is per-browser/per-device). The sidecar is hidden
  // (dot-prefixed) so it doesn't clutter the file browser.
  //
  // GET  /api/suplagentics/plans/annotations?path=<planPath>  → { annotations: [...] }
  // PUT  /api/suplagentics/plans/annotations?path=<planPath>  body { annotations: [...] }  → { ok: true }

  function annotationSidecarPath(planPath) {
    const dir = path.dirname(planPath);
    const base = path.basename(planPath);
    return path.join(dir, `.${base}.annotations.json`);
  }

  function isValidPlanPath(planPath) {
    if (typeof planPath !== 'string' || !planPath.trim() || planPath.includes('..')) return false;
    if (!path.isAbsolute(planPath) || !planPath.toLowerCase().endsWith('.md')) return false;
    // The annotator only touches plan files under a project's plans/ dir. Scope writes to that,
    // on ANY drive — projects live on C:/D:/Z:, so the old homeDir-only check rejected
    // D:\SuplAgentics's own plans (the cross-device feature then silently did nothing there).
    return path.basename(path.dirname(planPath)).toLowerCase() === 'plans';
  }

  // Read a plan file's content for the annotator, scoped to plans/ dirs on ANY drive. The general
  // /api/fs/read restricts to the ACTIVE workspace and rejects a plan in a DIFFERENT project (e.g.
  // Freedom45 on D:) as "outside active workspace" — which left the annotator unable to load the
  // fresh content after "Send for Review", so it kept showing the stale version.
  app.get('/api/suplagentics/plans/content', enforceSameOrigin, async (req, res) => {
    try {
      const planPath = req.query.path;
      if (!isValidPlanPath(planPath)) {
        res.status(400).json({ error: 'valid plan path is required' });
        return;
      }
      if (!existsSync(planPath)) {
        res.status(404).json({ error: 'plan not found' });
        return;
      }
      res.set('Cache-Control', 'no-store');
      res.json({ content: await readFile(planPath, 'utf8') });
    } catch (error) {
      console.error('Failed to read plan content:', error);
      res.status(500).json({ error: error?.message || 'Failed to read plan content' });
    }
  });

  app.get('/api/suplagentics/plans/annotations', enforceSameOrigin, async (req, res) => {
    try {
      const planPath = req.query.path;
      if (!isValidPlanPath(planPath)) {
        res.status(400).json({ error: 'valid path is required' });
        return;
      }
      const sidecar = annotationSidecarPath(planPath);
      if (!existsSync(sidecar)) {
        res.json({ annotations: [] });
        return;
      }
      const raw = await readFile(sidecar, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        res.json({ annotations: [] });
        return;
      }
      res.json({ annotations: parsed });
    } catch (error) {
      console.error('Failed to read annotations:', error);
      res.status(500).json({ error: error?.message || 'Failed to read annotations' });
    }
  });

  app.put('/api/suplagentics/plans/annotations', enforceSameOrigin, express.json({ limit: '8mb' }), async (req, res) => {
    try {
      const planPath = req.query.path;
      if (!isValidPlanPath(planPath)) {
        res.status(400).json({ error: 'valid path is required' });
        return;
      }
      const { annotations } = req.body || {};
      if (!Array.isArray(annotations)) {
        res.status(400).json({ error: 'annotations must be an array' });
        return;
      }
      const sidecar = annotationSidecarPath(planPath);
      const dir = path.dirname(sidecar);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      if (annotations.length === 0) {
        // Remove sidecar when all annotations are cleared (keep filesystem clean)
        if (existsSync(sidecar)) {
          try { await unlink(sidecar); } catch {}
        }
      } else {
        await writeFile(sidecar, JSON.stringify(annotations, null, 2) + '\n', 'utf8');
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Failed to save annotations:', error);
      res.status(500).json({ error: error?.message || 'Failed to save annotations' });
    }
  });
}
