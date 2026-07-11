import React from 'react';
import { toast } from '@/components/ui';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SuplagenticsSetupBanner } from './SuplagenticsSetupBanner';

interface ClaudeProject {
  id: string;
  path: string;
  name: string;
  memoryFileCount: number;
  sessionFileCount: number;
  importedSessionFileCount: number;
  importedMemoryFileCount: number;
  fullyImported: boolean;
  totalBytes: number;
  likelyJunk: boolean;
  isNew: boolean;
}

interface OpencodeProject {
  key: string;
  directory: string;
  name: string;
  sessionCount: number;
  importedCount: number;
  fullyImported: boolean;
  isNew: boolean;
}

interface ImportStatusResponse {
  imported: boolean;
  memoryFilesImported: number;
  chunksPending: number;
  chunksDone: number;
  memoryFilesPushed: number;
  memoryFilesPushPending: number;
  summarizing: boolean;
  pushing: boolean;
  importing: boolean;
  importCurrent: number;
  importTotal: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const NewBadge: React.FC = () => (
  <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
    New
  </span>
);

const ImportedBadge: React.FC = () => (
  <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
    <Icon name="check" className="size-3" />
    Imported
  </span>
);

// SuplAgentics's history-import port — one place to import both opencode's own session history
// and Claude Code's local session history (~/.claude/projects/), tied to the real projects they
// came from, into opencode-mem's real store. See plans/openchamber-fork-port.md.
export const ImportSettings: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [claudeAvailable, setClaudeAvailable] = React.useState(false);
  const [claudeProjects, setClaudeProjects] = React.useState<ClaudeProject[]>([]);
  const [opencodeProjects, setOpencodeProjects] = React.useState<OpencodeProject[]>([]);
  const [memStore, setMemStore] = React.useState<{ available: boolean; totalMemories: number; projectCount: number } | null>(null);
  const [status, setStatus] = React.useState<ImportStatusResponse | null>(null);
  const [importingKeys, setImportingKeys] = React.useState<Set<string>>(new Set());
  const [isDeduping, setIsDeduping] = React.useState(false);
  const [ignoreTarget, setIgnoreTarget] = React.useState<
    | { source: 'opencode'; project: OpencodeProject }
    | { source: 'claude-code'; project: ClaudeProject }
    | null
  >(null);
  const [deleteDataOnIgnore, setDeleteDataOnIgnore] = React.useState(true);
  const [isIgnoring, setIsIgnoring] = React.useState(false);

  const loadScan = React.useCallback(async () => {
    try {
      const res = await runtimeFetch('/api/suplagentics/import/scan');
      if (!res.ok) return;
      const data = await res.json();
      setClaudeAvailable(data.claude?.available === true);
      setClaudeProjects(Array.isArray(data.claude?.projects) ? data.claude.projects : []);
      setOpencodeProjects(Array.isArray(data.opencode?.projects) ? data.opencode.projects : []);
      setMemStore(data.memStore ?? null);
    } catch {
      // transient — next manual refresh or mount retries
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await runtimeFetch('/api/suplagentics/import/status');
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      // transient
    }
  }, []);

  React.useEffect(() => {
    void loadScan();
    void loadStatus();
  }, [loadScan, loadStatus]);

  // Poll only while something is actually running, so the progress numbers stay live without
  // polling forever once everything's settled.
  const isActive = status ? (status.importing || status.summarizing || status.pushing) : false;
  React.useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => void loadStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [isActive, loadStatus]);

  const handleImportClaude = React.useCallback(async (project: ClaudeProject) => {
    setImportingKeys((prev) => new Set(prev).add(project.id));
    try {
      const res = await runtimeFetch('/api/suplagentics/import/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'claude-code', projectIds: [project.id] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Failed to import ${project.name}`);
        return;
      }
      toast.success(`Importing ${project.name}…`);
      await runtimeFetch('/api/suplagentics/import/mark-seen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claude: [{ id: project.id, sessionFileCount: project.sessionFileCount, memoryFileCount: project.memoryFileCount }] }),
      });
      void loadStatus();
      void loadScan();
    } catch {
      toast.error(`Failed to import ${project.name}`);
    } finally {
      setImportingKeys((prev) => { const next = new Set(prev); next.delete(project.id); return next; });
    }
  }, [loadStatus, loadScan]);

  const handleImportOpencode = React.useCallback(async (project: OpencodeProject) => {
    setImportingKeys((prev) => new Set(prev).add(project.key));
    try {
      const res = await runtimeFetch('/api/suplagentics/import/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'opencode', directories: [project.directory] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || `Failed to import ${project.name}`);
        return;
      }
      toast.success(data.sessionsProcessed > 0 ? `Imported ${data.sessionsProcessed} session(s) from ${project.name}` : `Nothing new in ${project.name}`);
      await runtimeFetch('/api/suplagentics/import/mark-seen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ opencode: [{ key: project.key, sessionCount: project.sessionCount }] }),
      });
      void loadStatus();
      void loadScan();
    } catch {
      toast.error(`Failed to import ${project.name}`);
    } finally {
      setImportingKeys((prev) => { const next = new Set(prev); next.delete(project.key); return next; });
    }
  }, [loadStatus, loadScan]);

  const handleConfirmIgnore = React.useCallback(async () => {
    if (!ignoreTarget) return;
    setIsIgnoring(true);
    try {
      const body = ignoreTarget.source === 'claude-code'
        ? {
            source: 'claude-code',
            claudeId: ignoreTarget.project.id,
            // Only a genuinely recovered real path is useful for the memory/suggestion cleanup
            // below — a project whose path recovery failed has nothing on disk to clean up.
            directory: ignoreTarget.project.path !== ignoreTarget.project.id ? ignoreTarget.project.path : undefined,
            deleteData: deleteDataOnIgnore,
          }
        : {
            source: 'opencode',
            directory: ignoreTarget.project.directory,
            deleteData: deleteDataOnIgnore,
          };
      const res = await runtimeFetch('/api/suplagentics/import/ignore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || `Failed to remove ${ignoreTarget.project.name}`);
        return;
      }
      toast.success(`${ignoreTarget.project.name} removed from the import list`);
      setIgnoreTarget(null);
      void loadScan();
    } catch {
      toast.error(`Failed to remove ${ignoreTarget.project.name}`);
    } finally {
      setIsIgnoring(false);
    }
  }, [ignoreTarget, deleteDataOnIgnore, loadScan]);

  const handleDeduplicate = React.useCallback(async () => {
    setIsDeduping(true);
    try {
      const res = await runtimeFetch('/api/suplagentics/import/deduplicate', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Deduplication failed');
        return;
      }
      toast.success('Deduplication complete');
    } catch {
      toast.error('Deduplication failed');
    } finally {
      setIsDeduping(false);
    }
  }, []);

  const visibleClaudeProjects = React.useMemo(
    () => claudeProjects.filter((p) => !p.likelyJunk).sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || b.totalBytes - a.totalBytes),
    [claudeProjects],
  );
  const sortedOpencodeProjects = React.useMemo(
    () => [...opencodeProjects].sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || b.sessionCount - a.sessionCount),
    [opencodeProjects],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-busy-pulse" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="typography-ui-header font-semibold text-foreground">Import History</h3>
        <p className="typography-meta mt-0 text-muted-foreground/70">
          Import opencode and Claude Code session history into opencode-mem, tied to the projects they came from.
        </p>
      </div>

      <SuplagenticsSetupBanner />

      {memStore?.available && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-3 py-2.5">
          <div>
            <div className="typography-ui-header font-semibold text-foreground">{memStore.projectCount.toLocaleString()}</div>
            <div className="typography-meta text-muted-foreground/70">projects indexed</div>
          </div>
          <div className="h-8 w-px bg-border/60" />
          <div>
            <div className="typography-ui-header font-semibold text-foreground">{memStore.totalMemories.toLocaleString()}</div>
            <div className="typography-meta text-muted-foreground/70">memories stored</div>
          </div>
          <p className="typography-meta ml-auto max-w-[16rem] text-right text-muted-foreground/60">
            Totals across opencode-mem's whole store — every source, not just imports below.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="typography-meta text-muted-foreground/70">
          OpenCode: <span className="text-foreground">{sortedOpencodeProjects.filter((p) => p.fullyImported).length}/{sortedOpencodeProjects.length}</span> projects imported
        </p>
        <p className="typography-meta text-muted-foreground/70">
          Claude Code: <span className="text-foreground">{visibleClaudeProjects.filter((p) => p.fullyImported).length}/{visibleClaudeProjects.length}</span> projects imported
        </p>
      </div>

      {status && (isActive || status.chunksPending > 0 || status.memoryFilesPushPending > 0) && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40')} />
            <span className="typography-ui-label text-foreground">
              {status.importing ? `Reading files… (${status.importCurrent}/${status.importTotal})`
                : status.summarizing ? 'Summarizing imported history…'
                : status.pushing ? 'Pushing memories into opencode-mem…'
                : 'Idle'}
            </span>
          </div>
          <p className="typography-meta text-muted-foreground/70">
            {status.chunksDone} summarized, {status.chunksPending} pending · {status.memoryFilesImported} memory files ({status.memoryFilesPushPending} not yet pushed)
          </p>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="typography-ui-label font-semibold text-foreground">OpenCode Projects</h4>
        {sortedOpencodeProjects.length === 0 && (
          <p className="typography-meta text-muted-foreground/70">No opencode projects found.</p>
        )}
        <div className="space-y-1.5">
          {sortedOpencodeProjects.map((project) => (
            <div key={project.key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="typography-ui-label truncate text-foreground">{project.name}</span>
                  {project.isNew && <NewBadge />}
                </div>
                <p className="typography-meta truncate text-muted-foreground/70">{project.directory}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="typography-meta text-muted-foreground/70">
                  {project.importedCount}/{project.sessionCount} sessions
                </span>
                {project.fullyImported ? (
                  <ImportedBadge />
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={importingKeys.has(project.key) || project.sessionCount === 0}
                    onClick={() => handleImportOpencode(project)}
                  >
                    {importingKeys.has(project.key)
                      ? 'Importing…'
                      // Import is a point-in-time snapshot, not a live sync — a project you keep
                      // using picks up new sessions continuously, so "fully imported" is a moving
                      // target. Distinguishing "nothing done yet" from "just 1-2 new sessions
                      // since last time" avoids this reading as broken when it's actually working
                      // correctly (verified live: 147/148 imported, the 148th a session created
                      // moments earlier by ongoing use of this exact project).
                      : project.importedCount > 0
                        ? `Import ${project.sessionCount - project.importedCount} new`
                        : 'Import'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove from import list"
                  onClick={() => { setIgnoreTarget({ source: 'opencode', project }); setDeleteDataOnIgnore(true); }}
                >
                  <Icon name="close" className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-border/40 pt-6">
        <h4 className="typography-ui-label font-semibold text-foreground">Claude Code Projects</h4>
        {!claudeAvailable && (
          <p className="typography-meta text-muted-foreground/70">No Claude Code history found on this machine (~/.claude/projects not present).</p>
        )}
        {claudeAvailable && visibleClaudeProjects.length === 0 && (
          <p className="typography-meta text-muted-foreground/70">No Claude Code projects found.</p>
        )}
        <div className="space-y-1.5">
          {visibleClaudeProjects.map((project) => (
            <div key={project.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="typography-ui-label truncate text-foreground">{project.name}</span>
                  {project.isNew && <NewBadge />}
                </div>
                <p className="typography-meta truncate text-muted-foreground/70">{project.path}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="typography-meta text-muted-foreground/70">
                  {project.importedSessionFileCount}/{project.sessionFileCount} sessions · {project.importedMemoryFileCount}/{project.memoryFileCount} memories · {formatBytes(project.totalBytes)}
                </span>
                {project.fullyImported ? (
                  <ImportedBadge />
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={importingKeys.has(project.id)}
                    onClick={() => handleImportClaude(project)}
                  >
                    {importingKeys.has(project.id)
                      ? 'Importing…'
                      : project.importedSessionFileCount + project.importedMemoryFileCount > 0
                        ? `Import ${(project.sessionFileCount - project.importedSessionFileCount) + (project.memoryFileCount - project.importedMemoryFileCount)} new`
                        : 'Import'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove from import list"
                  onClick={() => { setIgnoreTarget({ source: 'claude-code', project }); setDeleteDataOnIgnore(true); }}
                >
                  <Icon name="close" className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border/40 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="typography-ui-label text-foreground">Deduplicate memories</p>
            <p className="typography-meta text-muted-foreground/70">Runs opencode-mem's own dedup pass over the whole memory store.</p>
          </div>
          <Button size="sm" variant="outline" disabled={isDeduping} onClick={handleDeduplicate}>
            <Icon name="refresh" className={cn('size-3.5', isDeduping && 'animate-spin')} />
            {isDeduping ? 'Running…' : 'Deduplicate'}
          </Button>
        </div>
      </div>

      <Dialog open={ignoreTarget !== null} onOpenChange={(open) => { if (!open && !isIgnoring) setIgnoreTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {ignoreTarget?.project.name}?</DialogTitle>
            <DialogDescription>
              This project won't be suggested for import again — it stays off the list even if new
              sessions or memories show up for it later. You can bring it back by manually adding
              it as a project or starting a fresh chat there.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2.5 rounded-lg border border-border bg-card p-3 cursor-pointer">
            <Checkbox checked={deleteDataOnIgnore} onChange={setDeleteDataOnIgnore} className="mt-0.5" />
            <span>
              <span className="typography-ui-label block text-foreground">Also delete what's already been imported</span>
              <span className="typography-meta block text-muted-foreground/70">
                Removes its memories from opencode-mem and any skill suggestions written for it.
                Leaves your actual project files untouched.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setIgnoreTarget(null)} disabled={isIgnoring}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={handleConfirmIgnore} disabled={isIgnoring}>
              {isIgnoring ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
