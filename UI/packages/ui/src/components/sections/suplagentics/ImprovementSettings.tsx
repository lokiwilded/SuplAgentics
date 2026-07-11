import React from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/components/ui';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { SettingsProjectSelector } from '@/components/sections/shared/SettingsProjectSelector';
import PlanAnnotator from '@/components/suplagentics/plan-annotator/PlanAnnotator';
import type { Annotation } from '@/components/suplagentics/plan-annotator/types';
import { SuplagenticsSetupBanner } from './SuplagenticsSetupBanner';

type SuggestionKind = 'skills' | 'agents' | 'workflows';

interface Suggestion {
  file: string;
  status: string;
  type: string;
  title: string;
  frequency_signal: string;
  created_at: string;
  problem: string;
  body: string;
  scope: 'project' | 'global';
  kind: SuggestionKind;
}

interface RunningScan {
  active: boolean;
  kind: string | null;
  scope: string | null;
  directory: string | null;
  phase: string;
  found: number;
  details: string;
}

interface ScanHistoryEntry {
  id: string;
  timestamp: string;
  kind: SuggestionKind;
  scope: 'project' | 'global';
  found: number;
  status: 'running' | 'complete' | 'failed';
}

const KINDS: Array<{ id: SuggestionKind; label: string }> = [
  { id: 'skills', label: 'Skills' },
  { id: 'agents', label: 'Agents' },
  { id: 'workflows', label: 'Workflows' },
];

type ViewTab = 'hq' | SuggestionKind;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    pending: 'border-border text-muted-foreground bg-muted/50',
    approved: 'border-primary/40 text-primary bg-primary/10',
    'needs-revision': 'border-amber-500/40 text-amber-500 bg-amber-500/10',
    dismissed: 'border-border text-muted-foreground/50 bg-transparent',
  };
  return (
    <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize', styles[status] || styles.pending)}>
      {status.replace('-', ' ')}
    </span>
  );
};

// SuplAgentics's Improvement page — an HQ command-center tab owns all the investigation controls
// (scope, per-kind + "scan all" buttons, live status, and a scan history log), while the Skills /
// Agents / Workflows tabs are clean display-only views of the mined suggestions, each showing a
// count badge and a "scan in progress" banner while HQ is running one. Suggestions are mined from
// opencode-mem by the insights-<kind> subagent family; Review reuses the plan-annotator, Build
// starts a real commander session.
export const ImprovementSettings: React.FC = () => {
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const activeProject = React.useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  );

  const [viewTab, setViewTab] = React.useState<ViewTab>('hq');
  const [scopeTab, setScopeTab] = React.useState<'project' | 'global'>('project');
  const [loading, setLoading] = React.useState(true);
  const [byKind, setByKind] = React.useState<Record<SuggestionKind, Suggestion[]>>({ skills: [], agents: [], workflows: [] });
  const [runningScan, setRunningScan] = React.useState<RunningScan | null>(null);
  const [scanHistory, setScanHistory] = React.useState<ScanHistoryEntry[]>([]);
  const [isScanning, setIsScanning] = React.useState(false);
  const [reviewingSuggestion, setReviewingSuggestion] = React.useState<Suggestion | null>(null);
  const [busyFile, setBusyFile] = React.useState<string | null>(null);

  const fetchKind = React.useCallback(async (kind: SuggestionKind): Promise<{ suggestions: Suggestion[]; runningScan: RunningScan | null } | null> => {
    if (!activeProject) return null;
    try {
      const res = await runtimeFetch(`/api/suplagentics/improvement/${kind}?directory=${encodeURIComponent(activeProject.path)}`);
      if (!res.ok) return null;
      const data = await res.json();
      const suggestions: Suggestion[] = (Array.isArray(data.suggestions) ? data.suggestions : []).map((s: Suggestion) => ({ ...s, kind }));
      return { suggestions, runningScan: data.runningScan ?? null };
    } catch {
      return null;
    }
  }, [activeProject]);

  const loadAll = React.useCallback(async () => {
    if (!activeProject) {
      setLoading(false);
      return;
    }
    const results = await Promise.all(KINDS.map((k) => fetchKind(k.id)));
    const next: Record<SuggestionKind, Suggestion[]> = { skills: [], agents: [], workflows: [] };
    let scan: RunningScan | null = null;
    results.forEach((r, i) => {
      if (r) {
        next[KINDS[i].id] = r.suggestions;
        if (r.runningScan) scan = r.runningScan;
      }
    });
    setByKind(next);
    setRunningScan(scan);
    setLoading(false);
  }, [activeProject, fetchKind]);

  React.useEffect(() => { void loadAll(); }, [loadAll]);

  // Poll while a scan is running so the live status, badges, and history stay current.
  React.useEffect(() => {
    if (!runningScan?.active) return;
    const timer = window.setInterval(() => void loadAll(), 4000);
    return () => window.clearInterval(timer);
  }, [runningScan?.active, loadAll]);

  const countFor = React.useCallback(
    (kind: SuggestionKind) => byKind[kind].filter((s) => s.scope === scopeTab).length,
    [byKind, scopeTab],
  );

  // Poll the shared scan lock until it goes idle (all scans run through a single server-side lock),
  // refreshing suggestions/status as it goes. Returns when idle or after a hard timeout.
  const waitForScanIdle = React.useCallback(async (): Promise<RunningScan | null> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5 * 60 * 1000) {
      await delay(3000);
      const r = await fetchKind('skills');
      if (r) {
        setRunningScan(r.runningScan);
        void loadAll();
        if (!r.runningScan?.active) return r.runningScan;
      }
    }
    return null;
  }, [fetchKind, loadAll]);

  const runScan = React.useCallback(async (kind: SuggestionKind) => {
    if (!activeProject) return;
    const entryId = `${Date.now()}-${kind}-${Math.random().toString(36).slice(2, 6)}`;
    setScanHistory((prev) => [
      { id: entryId, timestamp: new Date().toISOString(), kind, scope: scopeTab, found: 0, status: 'running' as const },
      ...prev,
    ].slice(0, 30));

    const before = countFor(kind);
    try {
      const body = scopeTab === 'project'
        ? { kind, scope: 'project', directory: activeProject.path }
        : { kind, scope: 'global', allProjectDirectories: projects.map((p) => p.path) };
      const res = await runtimeFetch('/api/suplagentics/improvement/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setScanHistory((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: 'failed' as const } : e)));
        toast.error(data?.error || `Failed to scan ${kind}`);
        return;
      }
      const done = await waitForScanIdle();
      // Prefer the server-reported "new found" delta; fall back to the observed count change.
      const found = typeof done?.found === 'number' && done.found >= 0 ? done.found : Math.max(0, countFor(kind) - before);
      setScanHistory((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: 'complete' as const, found } : e)));
    } catch {
      setScanHistory((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: 'failed' as const } : e)));
      toast.error(`Failed to scan ${kind}`);
    }
  }, [activeProject, scopeTab, projects, countFor, waitForScanIdle]);

  const investigate = React.useCallback(async (kinds: SuggestionKind[]) => {
    if (!activeProject || isScanning) return;
    setIsScanning(true);
    try {
      // Sequential — the server allows only one scan at a time, so "Scan all" queues them.
      for (const kind of kinds) {
        await runScan(kind);
      }
      toast.success(kinds.length > 1 ? 'All scans complete' : 'Scan complete');
    } finally {
      setIsScanning(false);
    }
  }, [activeProject, isScanning, runScan]);

  const doAction = React.useCallback(
    async (action: string, suggestion: Suggestion, annotations?: Annotation[]): Promise<boolean> => {
      if (!activeProject) return false;
      const res = await runtimeFetch('/api/suplagentics/improvement/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, kind: suggestion.kind, directory: activeProject.path, file: suggestion.file, annotations }),
      });
      return res.ok;
    },
    [activeProject],
  );

  const handleDismiss = React.useCallback(async (suggestion: Suggestion) => {
    setBusyFile(suggestion.file);
    try {
      if (!(await doAction('dismiss', suggestion))) { toast.error('Failed to dismiss suggestion'); return; }
      void loadAll();
    } finally {
      setBusyFile(null);
    }
  }, [doAction, loadAll]);

  const handleBuild = React.useCallback(async (suggestion: Suggestion) => {
    setBusyFile(suggestion.file);
    try {
      if (!(await doAction('build', suggestion))) { toast.error('Failed to start build'); return; }
      toast.success('Build started — switch to Chat to watch it work');
    } finally {
      setBusyFile(null);
    }
  }, [doAction]);

  const handleApprove = React.useCallback(async (annotations: Annotation[]) => {
    if (!reviewingSuggestion) return;
    if (!(await doAction('annotate-approve', reviewingSuggestion, annotations))) { toast.error('Failed to approve suggestion'); return; }
    toast.success('Approved — plan written');
    setReviewingSuggestion(null);
    void loadAll();
  }, [reviewingSuggestion, doAction, loadAll]);

  const handleDeny = React.useCallback(async (annotations: Annotation[]): Promise<boolean> => {
    if (!reviewingSuggestion) return false;
    try {
      if (!(await doAction('annotate-deny', reviewingSuggestion, annotations))) { toast.error('Failed to send feedback'); return false; }
      toast.success('Feedback recorded');
      setReviewingSuggestion(null);
      void loadAll();
      return true;
    } catch {
      toast.error('Failed to send feedback');
      return false;
    }
  }, [reviewingSuggestion, doAction, loadAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-busy-pulse" aria-label="Loading" />
      </div>
    );
  }

  if (!activeProject) {
    return <p className="typography-meta text-muted-foreground/70">Add a project first to see improvement suggestions for it.</p>;
  }

  const scanActive = isScanning || runningScan?.active === true;
  const visibleSuggestions = viewTab !== 'hq' ? byKind[viewTab].filter((s) => s.scope === scopeTab) : [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typography-ui-header font-semibold text-foreground">Improvements</h3>
        <p className="typography-meta mt-0 text-muted-foreground/70">
          Skill, agent, and workflow suggestions mined from opencode-mem's recurring patterns. Run scans from HQ; review results in each tab.
        </p>
      </div>

      <SuplagenticsSetupBanner />

      {/* Tabs: HQ | Skills | Agents | Workflows */}
      <div className="flex items-center gap-1 border-b border-border/40 pb-2">
        <button
          type="button"
          onClick={() => setViewTab('hq')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 typography-ui-label border',
            viewTab === 'hq'
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'border-transparent text-muted-foreground hover:bg-interactive-hover',
          )}
        >
          <Icon name="command" className="size-3.5" />
          HQ
        </button>
        <span className="mx-1 h-4 w-px bg-border/60" />
        {KINDS.map((k) => {
          const count = countFor(k.id);
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setViewTab(k.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 typography-ui-label',
                viewTab === k.id ? 'bg-interactive-selection text-foreground' : 'text-muted-foreground hover:bg-interactive-hover',
              )}
            >
              {k.label}
              {count > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {viewTab === 'hq' ? (
        <div className="space-y-4">
          {scopeTab === 'project' && <SettingsProjectSelector />}

          {/* Scope */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScopeTab('project')}
              className={cn(
                'rounded-md px-2.5 py-1 typography-ui-label',
                scopeTab === 'project' ? 'bg-interactive-selection text-foreground' : 'text-muted-foreground hover:bg-interactive-hover',
              )}
            >
              Per Project
            </button>
            <button
              type="button"
              onClick={() => setScopeTab('global')}
              className={cn(
                'rounded-md px-2.5 py-1 typography-ui-label',
                scopeTab === 'global' ? 'bg-interactive-selection text-foreground' : 'text-muted-foreground hover:bg-interactive-hover',
              )}
            >
              Global
            </button>
          </div>

          {/* Investigate buttons — per kind + all, scoped by the selector above */}
          <div className="space-y-2">
            <p className="typography-meta text-muted-foreground/70">
              Scan {scopeTab === 'project' ? 'this project' : 'across all projects'} for new suggestions:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {KINDS.map((k) => (
                <Button key={k.id} size="sm" variant="outline" disabled={scanActive} onClick={() => void investigate([k.id])}>
                  {k.label}
                </Button>
              ))}
              <Button size="sm" disabled={scanActive} onClick={() => void investigate(['skills', 'agents', 'workflows'])}>
                Scan all
              </Button>
            </div>
          </div>

          {/* Live status */}
          {scanActive && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <span className="typography-ui-label text-foreground">
                  {runningScan?.kind ? `Investigating ${runningScan.kind}…` : 'Investigating…'}
                </span>
              </div>
              <p className="typography-meta text-muted-foreground/70">Runs in the background — safe to navigate away.</p>
            </div>
          )}

          {/* Scan history */}
          <div className="space-y-1.5">
            <p className="typography-ui-label font-semibold text-foreground">Scan history</p>
            {scanHistory.length === 0 ? (
              <p className="typography-meta text-muted-foreground/70">No scans yet this session.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-1.5">
                {scanHistory.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-md px-2 py-1 typography-meta">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        e.status === 'running' ? 'bg-primary animate-pulse' : e.status === 'complete' ? 'bg-emerald-500' : 'bg-destructive',
                      )}
                    />
                    <span className="text-muted-foreground/60">{new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="capitalize text-foreground">{e.kind}</span>
                    <span className="text-muted-foreground/70">{e.scope === 'project' ? 'project' : 'global'}</span>
                    <span className="ml-auto text-muted-foreground/70">
                      {e.status === 'running' ? 'running…' : e.status === 'failed' ? 'failed' : `${e.found} new`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {scanActive && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <p className="typography-meta text-primary">Scan in progress — results will appear here when it completes.</p>
            </div>
          )}
          {visibleSuggestions.length === 0 ? (
            <p className="typography-meta text-muted-foreground/70">
              No {scopeTab === 'project' ? 'project' : 'global'} {viewTab.slice(0, -1)} suggestions yet — run a scan from HQ.
            </p>
          ) : (
            visibleSuggestions.map((suggestion) => (
              <div key={suggestion.file} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="typography-ui-label font-semibold text-foreground">{suggestion.title}</span>
                      <StatusBadge status={suggestion.status} />
                    </div>
                    {suggestion.frequency_signal && (
                      <p className="typography-meta text-muted-foreground/70 mt-0.5">{suggestion.frequency_signal}</p>
                    )}
                  </div>
                </div>
                {suggestion.problem && (
                  <p className="typography-meta text-muted-foreground line-clamp-3">{suggestion.problem}</p>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReviewingSuggestion(suggestion)} disabled={busyFile === suggestion.file}>
                    Review
                  </Button>
                  {suggestion.status === 'approved' && (
                    <Button size="sm" variant="outline" onClick={() => handleBuild(suggestion)} disabled={busyFile === suggestion.file}>
                      {busyFile === suggestion.file ? 'Starting…' : 'Build'}
                    </Button>
                  )}
                  {suggestion.status !== 'dismissed' && (
                    <Button size="sm" variant="ghost" onClick={() => handleDismiss(suggestion)} disabled={busyFile === suggestion.file}>
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {reviewingSuggestion && createPortal(
        <PlanAnnotator
          title={reviewingSuggestion.title}
          plan={reviewingSuggestion.body}
          planKey={reviewingSuggestion.file}
          onApprove={handleApprove}
          onDeny={handleDeny}
          onCancel={() => setReviewingSuggestion(null)}
        />,
        document.body,
      )}
    </div>
  );
};
