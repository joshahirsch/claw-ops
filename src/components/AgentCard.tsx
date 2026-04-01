import { Agent } from '@/data/types';
import StateIndicator from './StateIndicator';
import { Clock, Wrench, Gauge, GitBranch, Layers3 } from 'lucide-react';

interface AgentCardProps {
  agent: Agent;
  onClick: (agent: Agent) => void;
}

const AgentCard = ({ agent, onClick }: AgentCardProps) => {
  const confidenceColor = agent.confidence >= 0.8 ? 'text-success' : agent.confidence >= 0.5 ? 'text-warning' : 'text-destructive';
  const showRollup = !agent.hierarchy?.isSubSession && agent.childRollup;

  return (
    <button
      onClick={() => onClick(agent)}
      className="glass rounded-lg p-4 text-left w-full transition-all duration-200 hover:border-primary/30 hover:bg-card/80 group"
    >
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{agent.name}</h4>
            {agent.displayRole && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                {agent.displayRole}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{agent.currentTask}</p>
          {agent.parentAgentName && (
            <div className="flex items-center gap-1 mt-1 text-[10px] font-mono text-accent/80">
              <GitBranch className="w-3 h-3" />
              child of {agent.parentAgentName}
            </div>
          )}
          {showRollup && (
            <div className="flex items-center gap-1 mt-1 text-[10px] font-mono text-primary/80">
              <Layers3 className="w-3 h-3" />
              {agent.childRollup.summary}
            </div>
          )}
        </div>
        <StateIndicator state={agent.state} />
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {agent.elapsedTime}
        </span>
        <span className="flex items-center gap-1">
          <Wrench className="w-3 h-3" />
          <span className="font-mono">{agent.lastTool}</span>
        </span>
        <span className={`flex items-center gap-1 ${confidenceColor}`}>
          <Gauge className="w-3 h-3" />
          {Math.round(agent.confidence * 100)}%
        </span>
      </div>
    </button>
  );
};

export default AgentCard;
