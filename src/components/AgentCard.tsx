import { Agent } from '@/data/types';
import StateIndicator from './StateIndicator';
import { Clock, Wrench, Gauge } from 'lucide-react';

interface AgentCardProps {
  agent: Agent;
  onClick: (agent: Agent) => void;
}

const AgentCard = ({ agent, onClick }: AgentCardProps) => {
  const confidenceColor = agent.confidence >= 0.8 ? 'text-success' : agent.confidence >= 0.5 ? 'text-warning' : 'text-destructive';

  return (
    <button
      onClick={() => onClick(agent)}
      className="glass rounded-lg p-4 text-left w-full transition-all duration-200 hover:border-primary/30 hover:bg-card/80 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{agent.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{agent.currentTask}</p>
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
