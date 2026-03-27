import { useState } from 'react';
import { Bot, Brain, ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import { mockAgents, mockActivity } from '@/data/mockData';
import KPICard from '@/components/KPICard';
import LiveAgentMonitor from '@/components/LiveAgentMonitor';
import ActivityFeed from '@/components/ActivityFeed';
import AgentCard from '@/components/AgentCard';
import AgentDrawer from '@/components/AgentDrawer';
import { Agent } from '@/data/types';

const Dashboard = () => {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const active = mockAgents.filter(a => !['idle', 'complete'].includes(a.state)).length;
  const thinking = mockAgents.filter(a => a.state === 'thinking').length;
  const approval = mockAgents.filter(a => a.state === 'awaiting_approval').length;
  const blocked = mockAgents.filter(a => ['error', 'stalled'].includes(a.state)).length;
  const completed = mockAgents.filter(a => a.state === 'complete').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Real-time operational overview</p>
      </div>

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
          <LiveAgentMonitor agents={mockAgents} onAgentClick={setSelectedAgent} />
        </div>
        <div className="col-span-1">
          <ActivityFeed events={mockActivity} />
        </div>
      </div>

      {/* Agent Cards */}
      <div>
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Agent Status</h2>
        <div className="grid grid-cols-2 gap-3">
          {mockAgents.map(agent => (
            <AgentCard key={agent.id} agent={agent} onClick={setSelectedAgent} />
          ))}
        </div>
      </div>

      <AgentDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    </div>
  );
};

export default Dashboard;
