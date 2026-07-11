import React from 'react';
import { toast } from '@/components/ui';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { parseModelIdentifier } from '@/lib/modelIdentifier';
import { SuplagenticsSetupBanner } from './SuplagenticsSetupBanner';

interface IndexingStatus {
  imported: boolean;
  memoryFilesImported: number;
  chunksPending: number;
  chunksDone: number;
  memoryFilesPushed: number;
  memoryFilesPushPending: number;
  summarizing: boolean;
  pushing: boolean;
  stalled: boolean;
  stalledPending: number;
}

interface IndexingResponse {
  status: IndexingStatus;
  summarizerModel: string;
  insightsModel: string;
}

// SuplAgentics's Indexing settings — status and control for the pipeline that turns imported
// session history into memories (chunk queue → claude-import-summarizer → opencode-mem push),
// plus model configuration for the summarizer and the insights suggestion-mining agents. Model
// changes go through OpenChamber's own built-in agent config machinery server-side (the same
// code path as the Agents page), so a local Ollama model configured as a provider shows up here
// exactly like any cloud one.
export const IndexingSettings: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<IndexingStatus | null>(null);
  const [summarizerModel, setSummarizerModel] = React.useState('');
  const [insightsModel, setInsightsModel] = React.useState('');
  const [savedSummarizerModel, setSavedSummarizerModel] = React.useState('');
  const [savedInsightsModel, setSavedInsightsModel] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isResuming, setIsResuming] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await runtimeFetch('/api/suplagentics/indexing');
      if (!res.ok) return;
      const data: IndexingResponse = await res.json();
      setStatus(data.status ?? null);
      setSummarizerModel(data.summarizerModel ?? '');
      setInsightsModel(data.insightsModel ?? '');
      setSavedSummarizerModel(data.summarizerModel ?? '');
      setSavedInsightsModel(data.insightsModel ?? '');
    } catch {
      // transient — next poll or mount retries
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh only the status block while polling — never clobber in-flight model edits.
  const loadStatusOnly = React.useCallback(async () => {
    try {
      const res = await runtimeFetch('/api/suplagentics/indexing');
      if (!res.ok) return;
      const data: IndexingResponse = await res.json();
      setStatus(data.status ?? null);
    } catch {
      // transient
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const isActive = status ? (status.summarizing || status.pushing) : false;
  React.useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => void loadStatusOnly(), 3000);
    return () => window.clearInterval(timer);
  }, [isActive, loadStatusOnly]);

  const handleResume = React.useCallback(async () => {
    setIsResuming(true);
    try {
      const res = await runtimeFetch('/api/suplagentics/indexing/run', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Failed to start indexing');
        return;
      }
      toast.success('Indexing resumed');
      void loadStatusOnly();
    } catch {
      toast.error('Failed to start indexing');
    } finally {
      setIsResuming(false);
    }
  }, [loadStatusOnly]);

  const modelsDirty = summarizerModel !== savedSummarizerModel || insightsModel !== savedInsightsModel;

  const handleSaveModels = React.useCallback(async () => {
    setIsSaving(true);
    try {
      const body: Record<string, string> = {};
      if (summarizerModel !== savedSummarizerModel) body.summarizerModel = summarizerModel;
      if (insightsModel !== savedInsightsModel) body.insightsModel = insightsModel;
      const res = await runtimeFetch('/api/suplagentics/indexing/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Failed to save models');
        return;
      }
      setSavedSummarizerModel(summarizerModel);
      setSavedInsightsModel(insightsModel);
      toast.success('Indexing models updated');
    } catch {
      toast.error('Failed to save models');
    } finally {
      setIsSaving(false);
    }
  }, [summarizerModel, insightsModel, savedSummarizerModel, savedInsightsModel]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-busy-pulse" aria-label="Loading" />
      </div>
    );
  }

  const parsedSummarizer = parseModelIdentifier(summarizerModel);
  const parsedInsights = parseModelIdentifier(insightsModel);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="typography-ui-header font-semibold text-foreground">Indexing</h3>
        <p className="typography-meta mt-0 text-muted-foreground/70">
          The pipeline that turns imported session history into searchable memories, and the models it runs on.
          Pick a local model (e.g. an Ollama provider) to index without cloud cost.
        </p>
      </div>

      <SuplagenticsSetupBanner />

      {status && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-primary animate-pulse' : status.stalled ? 'bg-amber-500' : 'bg-muted-foreground/40')} />
            <span className="typography-ui-label text-foreground">
              {status.summarizing ? 'Summarizing imported history…'
                : status.pushing ? 'Pushing memories into opencode-mem…'
                : status.stalled ? 'Indexing stalled'
                : status.chunksPending > 0 ? 'Paused — pending work'
                : 'Idle — everything indexed'}
            </span>
          </div>
          <p className="typography-meta text-muted-foreground/70">
            {status.chunksDone} chunks summarized, {status.chunksPending} pending · {status.memoryFilesImported} memory files ({status.memoryFilesPushPending} not yet pushed)
          </p>
          {status.stalled && (
            <p className="typography-meta text-amber-500">
              The last indexing run finished a full pass without completing any of the {status.stalledPending} remaining chunk(s) —
              usually a failing push to opencode-mem (is it running at :4747?) or content the current model can't process.
              Fix the cause (or switch the model below), then retry.
            </p>
          )}
          {(status.stalled || (!isActive && (status.chunksPending > 0 || status.memoryFilesPushPending > 0))) && (
            <div className="pt-1">
              <Button size="sm" variant="outline" disabled={isResuming} onClick={handleResume}>
                {isResuming ? 'Starting…' : status.stalled ? 'Retry indexing' : 'Resume indexing'}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4 border-t border-border/40 pt-6">
        <div>
          <h4 className="typography-ui-label font-semibold text-foreground">Models</h4>
          <p className="typography-meta text-muted-foreground/70">
            Saved straight into the agents' own config — the same as editing them on the Agents page.
          </p>
        </div>

        <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-8">
          <div className="sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">Indexing model</span>
            <p className="typography-meta text-muted-foreground/70">Summarizes imported transcripts (claude-import-summarizer).</p>
          </div>
          <ModelSelector
            providerId={parsedSummarizer?.providerId ?? ''}
            modelId={parsedSummarizer?.modelId ?? ''}
            onChange={(providerId: string, modelId: string) => {
              setSummarizerModel(providerId && modelId ? `${providerId}/${modelId}` : '');
            }}
          />
        </div>

        <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-8">
          <div className="sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">Insights model</span>
            <p className="typography-meta text-muted-foreground/70">Mines memories for skill/agent/workflow suggestions (the whole insights family).</p>
          </div>
          <ModelSelector
            providerId={parsedInsights?.providerId ?? ''}
            modelId={parsedInsights?.modelId ?? ''}
            onChange={(providerId: string, modelId: string) => {
              setInsightsModel(providerId && modelId ? `${providerId}/${modelId}` : '');
            }}
          />
        </div>

        <div>
          <Button size="sm" disabled={!modelsDirty || isSaving} onClick={handleSaveModels}>
            {isSaving ? 'Saving…' : 'Save models'}
          </Button>
        </div>
      </div>
    </div>
  );
};
