import { useState } from 'react';
import { mockApprovals } from '@/data/mockData';
import { Approval } from '@/data/types';
import { ShieldCheck, Check, X } from 'lucide-react';

const ApprovalsPage = () => {
  const [approvals, setApprovals] = useState<Approval[]>(mockApprovals);

  const handleAction = (id: string, action: 'approved' | 'rejected') => {
    setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: action } : a));
  };

  const pending = approvals.filter(a => a.status === 'pending');
  const resolved = approvals.filter(a => a.status !== 'pending');

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{pending.length} pending</p>
      </div>

      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Pending</h2>
          {pending.map(approval => (
            <div key={approval.id} className="glass rounded-lg p-4 border-warning/20">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{approval.action}</p>
                    <p className="text-xs text-muted-foreground mt-1">{approval.reason}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px] font-mono text-primary/70">{approval.agentName}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{approval.timestamp}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleAction(approval.id, 'approved')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 border border-success/30 text-success text-xs font-medium hover:bg-success/20 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => handleAction(approval.id, 'rejected')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Resolved</h2>
          {resolved.map(approval => (
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
    </div>
  );
};

export default ApprovalsPage;
