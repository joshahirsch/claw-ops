import { useState } from 'react';
import { mockAgents } from '@/data/mockData';
import AgentCard from '@/components/AgentCard';
import AgentDrawer from '@/components/AgentDrawer';
import StateIndicator from '@/components/StateIndicator';
import { Agent, AgentState } from '@/data/types';

const states: AgentState[] = ['thinking', 'tool_active', 'multi_step', 'awaiting_approval', 'error', 'stalled', 'idle', 'complete'];

const AgentsPage = () => {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [filter, setFilter] = useState<AgentState | 'all'>('all');

  const filtered = filter === 'all' ? mockAgents : mockAgents.filter(a => a.state === filter);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Agents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{mockAgents.length} registered agents</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${filter === 'all' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
        >
          All ({mockAgents.length})
        </button>
        {states.map(s => {
          const count = mockAgents.filter(a => a.state === s).length;
          if (count === 0) return null;
          return (
            <button key={s} onClick={() => setFilter(s)} className={`transition-colors ${filter === s ? 'ring-1 ring-primary/50' : ''}`}>
              <StateIndicator state={s} size="md" />
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {filtered.map(agent => (
          <AgentCard key={agent.id} agent={agent} onClick={setSelectedAgent} />
        ))}
      </div>

      <AgentDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    </div>
  );
};

export default AgentsPage;
