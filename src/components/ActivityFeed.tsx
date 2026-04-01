import { ActivityEvent } from '@/data/types';
import { Bot, Wrench, AlertTriangle, ShieldCheck, CheckCircle, MessageSquare, Pause, GitBranch } from 'lucide-react';

interface ActivityFeedProps {
  events: ActivityEvent[];
  maxItems?: number;
}

const typeIcons: Record<string, typeof Bot> = {
  reasoning: Bot,
  tool_use: Wrench,
  error: AlertTriangle,
  approval_request: ShieldCheck,
  completed: CheckCircle,
  incoming: MessageSquare,
  stalled: Pause,
};

const severityColors: Record<string, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
  critical: 'text-destructive',
};

const ActivityFeed = ({ events, maxItems = 8 }: ActivityFeedProps) => {
  const Icon = (type: string) => typeIcons[type] || Bot;

  return (
    <div className="glass rounded-lg p-4 h-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Live Feed</h3>
      </div>
      <div className="space-y-1 overflow-y-auto max-h-[400px] scrollbar-thin">
        {events.slice(0, maxItems).map((event) => {
          const IconComponent = Icon(event.type);
          return (
            <div key={event.id} className="flex items-start gap-2.5 p-2 rounded-md hover:bg-secondary/50 transition-colors">
              <IconComponent className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${severityColors[event.severity]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground/90 leading-relaxed line-clamp-2">{event.message}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground">{event.timestamp}</span>
                  <span className="text-[10px] font-mono text-primary/70">{event.agentName}</span>
                  {event.isSubSession && event.parentAgentName && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-accent/80">
                      <GitBranch className="w-3 h-3" />
                      via {event.parentAgentName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityFeed;
