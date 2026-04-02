import { useState } from 'react';
import { Bot, Brain, ShieldCheck, AlertTriangle, CheckCircle, Wifi } from 'lucide-react';
import { useOpenClawData } from '@/hooks/useOpenClawData';
import KPICard from '@/components/KPICard';
import LiveAgentMonitor from '@/components/LiveAgentMonitor';
import ActivityFeed from '@/components/ActivityFeed';
import AgentCard from '@/components/AgentCard';
import AgentDrawer from '@/components/AgentDrawer';
import { Agent } from '@/data/types';

const Dashboard = () => {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const { agents, activity, isLive, isLoading, error, usingMockData } = useOpenClawData();

  const active = agents.filter(a => !['idle', 'complete'].includes(a.state)).length;
  const thinking = agents.filter(a => a.state === 'thinking').length;
  const approval = agents.filter(a => a.state === 'awaiting_approval').length;
  const blocked = agents.filter(a => ['error', 'stalled'].includes(a.state)).length;
  const completed = agents.filter(a => a.state === 'complete').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {usingMockData ? 'Demo operational overview' : 'Real-time operational overview'}
          </p>
        </div>
        {isLive && (
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-success">
            <Wifi className="w-3 h-3" />
            LIVE
          </div>
        )}
      </div>

      {error && (
        <div className="glass rounded-md p-3 text-sm text-destructive border border-destructive/20">
          Connection error: {error}
        </div>
      )}

      {isLoading && agents.length === 0 && (
        <div className="glass rounded-md p-4 text-sm text-muted-foreground">Loading dashboard…</div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3">
        <KPICard label="Active Agents" value={active} icon={<Bot className="w-4 h-4" />} variant="primary" />
        <KPICard label="Thinking Now" value={thinking} icon={<Brain className="w-4 h-4" />} />
        <KPICard label="Awaiting Approval" value={approval} icon={<ShieldCheck className="w-4 h-4" />} variant="warning" />
        <KPICard label="Blocked" value={blocked} icon={<AlertTriangle className="w-4 h-4" />} variant="error" />
        <KPICard label="Completed Today" value={completed} icon={<CheckCircle className="w-4 h-4" />} variant="success" />
      </div>

      {/* Monitor + Feed */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <LiveAgentMonitor agents={agents} onAgentClick={setSelectedAgent} />
        </div>
        <div className="col-span-1">
          <ActivityFeed events={activity} />
        </div>
      </div>

      {/* Agent Cards */}
      <div>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Agent Status</h2>
        {agents.length === 0 && !isLoading ? (
          <div className="glass rounded-md p-4 text-sm text-muted-foreground">
            No live agents are available for the current session configuration.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {agents.map(agent => (
              <AgentCard key={agent.id} agent={agent} onClick={setSelectedAgent} />
            ))}
          </div>
        )}
      </div>

      <AgentDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    </div>
  );
};

export default Dashboard;
