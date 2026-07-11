// Registers a directory into OpenChamber's OWN real project list (the one backing the left
// sidebar, session resume, and every project selector across Settings) — not a separate
// SuplAgentics-side tracking file. Verified live: OpenChamber's project list is just one field
// (`projects`) inside its single settings blob, read via `readSettingsFromDiskMigrated()` and
// written via `persistSettings({ projects: [...] })` (packages/web/server/lib/opencode/
// settings-runtime.js) — the exact same path the frontend's "Add Project" flow uses
// (useProjectsStore.addProject -> updateDesktopSettings -> PUT /api/config/settings). Importing
// history for a directory that isn't already a tracked project previously left that directory
// invisible everywhere else in the UI (no sidebar entry, no project-selector entry) even though
// its data now existed in opencode-mem/the import queue — this closes that gap by adding it the
// same way the UI itself would, deterministic id included, so it can't create a duplicate entry.
//
// `createProjectIdFromPath`/`sanitizeProjects` do real path normalization + realpath resolution
// (they hit the filesystem), so this doesn't try to duplicate that logic — it just calls the same
// dependencies the real /api/config/settings route already uses.

export async function registerProjectIfNew(directory, { readSettingsFromDiskMigrated, persistSettings, sanitizeProjects, createProjectIdFromPath }) {
  if (!directory) return;
  try {
    const settings = await readSettingsFromDiskMigrated();
    const existingProjects = Array.isArray(settings.projects) ? settings.projects : [];
    const sanitizedExisting = sanitizeProjects(existingProjects) || [];

    // sanitizeProjects resolves realpaths, so compare against its own normalized output rather
    // than a naive string comparison against the raw input directory.
    const candidateId = createProjectIdFromPath(directory);
    const alreadyTracked = sanitizedExisting.some((p) => p.id === candidateId);
    if (alreadyTracked) return;

    const now = Date.now();
    const nextProjects = [
      ...sanitizedExisting,
      { id: candidateId, path: directory, addedAt: now, lastOpenedAt: now },
    ];
    await persistSettings({ projects: nextProjects });
  } catch {
    // Best-effort — a failure here shouldn't block the import itself; the data still lands in
    // opencode-mem/the import queue even if the project doesn't get auto-tracked this time.
  }
}
