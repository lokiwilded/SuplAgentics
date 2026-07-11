import React from 'react';
import { toast } from '@/components/ui';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';

interface SetupStatus {
  installed: boolean;
  active: boolean;
  step: string;
  error: string | null;
}

// Shown at the top of Import History / Improvements — the two pages that are completely
// non-functional on a fresh install (no agents, no opencode.json config, no memory plugin) until
// this one-time setup runs. See installer.js for what "installed" actually does.
export const SuplagenticsSetupBanner: React.FC = () => {
  const [status, setStatus] = React.useState<SetupStatus | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await runtimeFetch('/api/suplagentics/setup/status');
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      // transient
    }
  }, []);

  React.useEffect(() => { void loadStatus(); }, [loadStatus]);

  React.useEffect(() => {
    if (!status?.active) return;
    const timer = window.setInterval(() => void loadStatus(), 1500);
    return () => window.clearInterval(timer);
  }, [status?.active, loadStatus]);

  const handleInstall = React.useCallback(async () => {
    try {
      const res = await runtimeFetch('/api/suplagentics/setup/install', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || 'Failed to start setup');
        return;
      }
      void loadStatus();
    } catch {
      toast.error('Failed to start setup');
    }
  }, [loadStatus]);

  React.useEffect(() => {
    if (status && !status.active && !status.error && status.installed && status.step === 'Done') {
      toast.success('SuplAgentics set up — agents, config, and memory plugin are ready.');
    }
  }, [status]);

  if (!status || status.installed || dismissed) return null;

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="typography-ui-label font-semibold text-foreground">Set up SuplAgentics</p>
          <p className="typography-meta text-muted-foreground/70">
            {status.active
              ? status.step
              : status.error
                ? `Last attempt failed: ${status.error}`
                : 'This installs the SuplAgentics agents, opencode.json config, and memory plugin — nothing here works until this runs once.'}
          </p>
        </div>
        {!status.active && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground text-sm px-1"
            aria-label="Dismiss"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        )}
      </div>
      <Button size="sm" variant="outline" disabled={status.active} onClick={handleInstall}>
        <Icon name="download" className={cn('size-3.5', status.active && 'animate-pulse')} />
        {status.active ? 'Setting up…' : status.error ? 'Retry setup' : 'Set up now'}
      </Button>
    </div>
  );
};
