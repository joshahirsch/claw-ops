import { Agent } from '@/data/types';
import StateIndicator from './StateIndicator';
import { X, Clock, Target, Wrench, AlertTriangle, Play, GitBranch, Network, Layers3 } from 'lucide-react';

interface AgentDrawerProps {
  agent: Agent | null;
  onClose: () => void;
}

const AgentDrawer = ({ agent, onClose }: AgentDrawerProps) => {
  if (!agent) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-card border-l border-border h-full overflow-y-auto animate-slide-in-right scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card/95 backdrop-blur-xl border-b border-border p-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-semibold text-foreground">{agent.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StateIndicator state={agent.state} size="md" />
              {agent.displayRole && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                  {agent.displayRole}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-secondary transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {agent.hierarchy && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Network className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Session Topology</h3>
              </div>
              <div className="space-y-1.5 text-xs text-foreground/85">
                <div>Root session: <span className="font-mono text-muted-foreground">{agent.hierarchy.rootSessionKey}</span></div>
                {agent.hierarchy.parentSessionKey && (
                  <div className="flex items-center gap-1 text-accent/80">
                    <GitBranch className="w-3 h-3" />
                    Parent session: <span className="font-mono">{agent.hierarchy.parentSessionKey}</span>
                  </div>
                )}
                {typeof agent.hierarchy.childSessionCount === 'number' && agent.hierarchy.childSessionCount > 0 && (
                  <div>Child sub-sessions: <span className="font-mono text-muted-foreground">{agent.hierarchy.childSessionCount}</span></div>
                )}
              </div>
            </div>
          )}

          {agent.childRollup && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Layers3 className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Child Rollup</h3>
              </div>
              <div className="space-y-1.5 text-xs text-foreground/85">
                <div>Summary: <span className="font-mono text-muted-foreground">{agent.childRollup.summary}</span></div>
                <div>Active: <span className="font-mono text-muted-foreground">{agent.childRollup.active}</span></div>
                <div>Waiting: <span className="font-mono text-muted-foreground">{agent.childRollup.waiting}</span></div>
                <div>Failed: <span className="font-mono text-muted-foreground">{agent.childRollup.failed}</span></div>
                <div>Stalled: <span className="font-mono text-muted-foreground">{agent.childRollup.stalled}</span></div>
                <div>Completed: <span className="font-mono text-muted-foreground">{agent.childRollup.completed}</span></div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Objective</h3>
            </div>
            <p className="text-sm text-foreground/90">{agent.objective}</p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Current Task</h3>
            </div>
            <p className="text-sm text-foreground/90">{agent.currentTask}</p>
            <p className="text-xs text-muted-foreground mt-1">Elapsed: {agent.elapsedTime}</p>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Wrench className="w-3.5 h-3.5 text-accent" />
              <span className="font-mono text-xs text-muted-foreground">{agent.lastTool}</span>
            </div>
          </div>

          {agent.blockers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Blockers</h3>
              </div>
              <div className="space-y-1.5">
                {agent.blockers.map((b, i) => (
                  <div key={i} className="text-xs text-warning/90 bg-warning/5 border border-warning/20 rounded-md px-3 py-2">
                    {b}
                  </div>
                ))}
              </div>
            </div>
          )}

          {agent.approvalNeeded && (
            <div className="bg-warning/5 border border-warning/20 rounded-lg p-3">
              <p className="text-xs font-medium text-warning">⚠ Approval Required</p>
              <p className="text-xs text-muted-foreground mt-1">This agent is paused pending your approval.</p>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Play className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Recent Actions</h3>
            </div>
            <div className="space-y-0">
              {agent.actions.map((action, i) => (
                <div key={action.id} className="flex gap-3 relative">
                  {i < agent.actions.length - 1 && (
                    <div className="absolute left-[7px] top-5 bottom-0 w-px bg-border" />
                  )}
                  <div className="w-[15px] flex justify-center pt-1.5 shrink-0">
                    <div className={`w-2 h-2 rounded-full ${action.type === 'error' ? 'bg-destructive' : action.type === 'tool_use' ? 'bg-accent' : 'bg-primary/60'}`} />
                  </div>
                  <div className="pb-3 min-w-0 flex-1">
                    <p className="text-xs text-foreground/90">{action.description}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">{action.timestamp}</span>
                      {action.actorLabel && <span className="text-[10px] font-mono text-primary/70">{action.actorLabel}</span>}
                      {action.tool && <span className="text-[10px] font-mono text-accent/70">{action.tool}</span>}
                      {action.duration && <span className="text-[10px] font-mono text-muted-foreground">{action.duration}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentDrawer;
