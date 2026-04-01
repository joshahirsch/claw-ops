import { useMemo } from 'react';
import { mockFailures } from '@/data/mockData';
import { useOpenClawData } from '@/hooks/useOpenClawData';
import { sessionsToFailures } from '@/lib/openclaw/adapter';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Severity } from '@/data/types';

const severityBadge: Record<Severity, string> = {
  low: 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20',
  medium: 'bg-warning/10 text-warning border-warning/20',
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  critical: 'bg-destructive/20 text-destructive border-destructive/40',
};

const statusChip: Record<string, string> = {
  blocked: 'bg-warning/10 text-warning border-warning/20',
  failed: 'bg-destructive/10 text-destructive border-destructive/20',
  retrying: 'bg-accent/10 text-accent border-accent/20',
  resolved: 'bg-success/10 text-success border-success/20',
};

const FailuresPage = () => {
  const { sessions, isLoading, error, usingMockData } = useOpenClawData();

  const { failures, adapterError } = useMemo(() => {
    if (usingMockData) {
      return { failures: mockFailures, adapterError: null as string | null };
    }

    try {
      return { failures: sessionsToFailures(sessions), adapterError: null as string | null };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown adapter error';
      console.error('[FailuresPage]', e);
      return { failures: [], adapterError: `Adapter error: ${message}` };
    }
  }, [sessions, usingMockData]);

  const displayError = error && adapterError ? `${error} | ${adapterError}` : error || adapterError;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Failures</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {usingMockData ? 'Demo failures view' : 'Live derived operational issues'} · {failures.length} issues
        </p>
      </div>

      {displayError && (
        <div className="glass rounded-md p-3 text-sm text-destructive border border-destructive/20">
          Connection error: {displayError}
        </div>
      )}

      {isLoading && failures.length === 0 && (
        <div className="glass rounded-md p-4 text-sm text-muted-foreground">Loading failures…</div>
      )}

      {!isLoading && failures.length === 0 && (
        <div className="glass rounded-md p-4 text-sm text-muted-foreground">
          No live failures are currently derived from the active session set.
        </div>
      )}

      <div className="space-y-3">
        {failures.map((failure) => (
          <div key={failure.id} className="glass rounded-lg p-4">
            <div className="flex items-start justify-between mb-3 gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{failure.task}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{failure.agentName} · {failure.timestamp}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${severityBadge[failure.severity]}`}>
                  {failure.severity}
                </span>
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${statusChip[failure.status]}`}>
                  {failure.status}
                </span>
              </div>
            </div>

            <div className="ml-8 space-y-2">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">Probable Cause</p>
                <p className="text-xs text-foreground/80">{failure.cause}</p>
              </div>
              <div className="flex items-start gap-2">
                <ArrowRight className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">Recommended</p>
                  <p className="text-xs text-primary/90">{failure.recommendedAction}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FailuresPage;
