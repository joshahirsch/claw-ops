import { useMemo } from 'react';
import { mockApprovals } from '@/data/mockData';
import { useOpenClawData } from '@/hooks/useOpenClawData';
import { sessionsToApprovals } from '@/lib/openclaw/adapter';
import { ShieldCheck } from 'lucide-react';

const ApprovalsPage = () => {
  const { sessions, isLoading, error, usingMockData } = useOpenClawData();

  const { approvals, adapterError } = useMemo(() => {
    if (usingMockData) {
      return { approvals: mockApprovals, adapterError: null as string | null };
    }

    try {
      return { approvals: sessionsToApprovals(sessions), adapterError: null as string | null };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown adapter error';
      console.error('[ApprovalsPage]', e);
      return { approvals: [], adapterError: `Adapter error: ${message}` };
    }
  }, [sessions, usingMockData]);

  const displayError = error && adapterError ? `${error} | ${adapterError}` : error || adapterError;
  const pending = approvals.filter((a) => a.status === 'pending');
  const resolved = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {usingMockData ? 'Demo approvals queue' : 'Live read-only approval queue'} · {pending.length} pending
        </p>
      </div>

      {!usingMockData && (
        <div className="glass rounded-md p-3 text-xs text-muted-foreground border border-border/70">
          This page is read-only in pass 2A. It reflects sessions currently waiting for approval, but does not send approve or reject actions yet.
        </div>
      )}

      {displayError && (
        <div className="glass rounded-md p-3 text-sm text-destructive border border-destructive/20">
          Connection error: {displayError}
        </div>
      )}

      {isLoading && approvals.length === 0 && (
        <div className="glass rounded-md p-4 text-sm text-muted-foreground">Loading approvals…</div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Pending</h2>
          {pending.map((approval) => (
            <div key={approval.id} className="glass rounded-lg p-4 border-warning/20">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-warning mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{approval.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">{approval.reason}</p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="text-[11px] font-mono text-primary/70">{approval.agentName}</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{approval.timestamp}</span>
                    <span className="text-[11px] font-mono uppercase text-warning">pending</span>
                  </div>
                  {approval.notes && (
                    <p className="text-[11px] text-muted-foreground mt-2">{approval.notes}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Resolved</h2>
          {resolved.map((approval) => (
            <div key={approval.id} className="glass rounded-lg p-4 opacity-60">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-foreground/70">{approval.action}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-[11px] font-mono uppercase ${approval.status === 'approved' ? 'text-success' : 'text-destructive'}`}>
                      {approval.status}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">{approval.agentName}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && approvals.length === 0 && (
        <div className="glass rounded-md p-4 text-sm text-muted-foreground">
          No approvals are currently waiting in the live session set.
        </div>
      )}
    </div>
  );
};

export default ApprovalsPage;
