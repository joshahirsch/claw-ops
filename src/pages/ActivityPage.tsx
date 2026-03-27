import { useState } from 'react';
import { mockActivity } from '@/data/mockData';
import { Bot, Wrench, AlertTriangle, ShieldCheck, CheckCircle, MessageSquare, Pause, Search } from 'lucide-react';
import { Severity } from '@/data/types';

const typeIcons: Record<string, typeof Bot> = {
  reasoning: Bot,
  tool_use: Wrench,
  error: AlertTriangle,
  approval_request: ShieldCheck,
  completed: CheckCircle,
  incoming: MessageSquare,
  stalled: Pause,
};

const severityColors: Record<Severity, string> = {
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
  critical: 'text-destructive',
};

const ActivityPage = () => {
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');

  const filtered = mockActivity.filter(e => {
    if (search && !e.message.toLowerCase().includes(search.toLowerCase()) && !e.agentName.toLowerCase().includes(search.toLowerCase())) return false;
    if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Activity</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Live event stream</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        {(['all', 'low', 'medium', 'high'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-mono capitalize transition-colors ${severityFilter === s ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        {filtered.map(event => {
          const Icon = typeIcons[event.type] || Bot;
          return (
            <div key={event.id} className="glass rounded-md p-3 flex items-start gap-3 hover:bg-card/80 transition-colors">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${severityColors[event.severity]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90">{event.message}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[11px] font-mono text-muted-foreground">{event.timestamp}</span>
                  <span className="text-[11px] font-mono text-primary/70">{event.agentName}</span>
                  {event.tool && <span className="text-[11px] font-mono text-accent/70">{event.tool}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityPage;
