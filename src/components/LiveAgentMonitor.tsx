import { motion } from 'framer-motion';
import { Agent, AgentState } from '@/data/types';

interface AgentNodeProps {
  agent: Agent;
  index: number;
  onClick: (agent: Agent) => void;
}

const stateStyles: Record<AgentState, {
  fill: string;
  glow: string;
  animation: string;
}> = {
  idle: { fill: '#4a5568', glow: 'rgba(74,85,104,0.2)', animation: 'none' },
  thinking: { fill: '#2dd4bf', glow: 'rgba(45,212,191,0.4)', animation: 'breathe' },
  tool_active: { fill: '#8b5cf6', glow: 'rgba(139,92,246,0.5)', animation: 'pulse' },
  multi_step: { fill: '#2dd4bf', glow: 'rgba(45,212,191,0.35)', animation: 'orbit' },
  awaiting_approval: { fill: '#f59e0b', glow: 'rgba(245,158,11,0.4)', animation: 'warning' },
  error: { fill: '#ef4444', glow: 'rgba(239,68,68,0.5)', animation: 'glitch' },
  stalled: { fill: '#f59e0b', glow: 'rgba(245,158,11,0.3)', animation: 'stalled' },
  complete: { fill: '#22c55e', glow: 'rgba(34,197,94,0.2)', animation: 'settle' },
};

const AgentNode = ({ agent, index, onClick }: AgentNodeProps) => {
  const style = stateStyles[agent.state];
  const cols = 4;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const x = 80 + col * 130;
  const y = 60 + row * 120;

  const getMotionProps = () => {
    switch (agent.state) {
      case 'thinking':
        return { animate: { scale: [0.95, 1.08, 0.95], opacity: [0.6, 1, 0.6] }, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } };
      case 'tool_active':
        return { animate: { scale: [1, 1.12, 1], opacity: [0.8, 1, 0.8] }, transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } };
      case 'error':
        return { animate: { x: [-2, 2, -1, 1, 0], opacity: [1, 0.7, 1] }, transition: { duration: 0.4, repeat: Infinity } };
      case 'stalled':
        return { animate: { scale: [1, 1.02, 1], opacity: [0.4, 0.6, 0.4] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } };
      case 'awaiting_approval':
        return { animate: { scale: [1, 1.05, 1] }, transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' } };
      case 'complete':
        return { animate: { opacity: [1, 0.7] }, transition: { duration: 2, ease: 'easeInOut' } };
      default:
        return { animate: { opacity: 0.5 } };
    }
  };

  return (
    <g
      className="cursor-pointer"
      onClick={() => onClick(agent)}
    >
      {/* Outer glow */}
      <motion.circle
        cx={x}
        cy={y}
        r={30}
        fill="none"
        stroke={style.fill}
        strokeWidth={1}
        opacity={0.15}
        {...(agent.state === 'awaiting_approval' ? {
          animate: { r: [30, 38, 30], opacity: [0.15, 0.3, 0.15] },
          transition: { duration: 2, repeat: Infinity },
        } : agent.state === 'error' ? {
          animate: { r: [30, 34, 30], opacity: [0.2, 0.4, 0.2] },
          transition: { duration: 0.8, repeat: Infinity },
        } : {})}
      />

      {/* Ripple for tool_active */}
      {agent.state === 'tool_active' && (
        <motion.circle
          cx={x}
          cy={y}
          r={20}
          fill="none"
          stroke={style.fill}
          strokeWidth={1.5}
          animate={{ r: [20, 45], opacity: [0.5, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      {/* Multi-step orbiting nodes */}
      {agent.state === 'multi_step' && [0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={x}
          cy={y}
          r={3}
          fill={style.fill}
          opacity={0.7}
          animate={{
            cx: [x + 28 * Math.cos(i * 2.094), x + 28 * Math.cos(i * 2.094 + Math.PI), x + 28 * Math.cos(i * 2.094 + Math.PI * 2)],
            cy: [y + 28 * Math.sin(i * 2.094), y + 28 * Math.sin(i * 2.094 + Math.PI), y + 28 * Math.sin(i * 2.094 + Math.PI * 2)],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: 'linear', delay: i * 0.3 }}
        />
      ))}

      {/* Core node */}
      <motion.circle
        cx={x}
        cy={y}
        r={18}
        fill={style.glow}
        stroke={style.fill}
        strokeWidth={1.5}
        {...getMotionProps()}
      />

      {/* Inner dot */}
      <circle cx={x} cy={y} r={4} fill={style.fill} opacity={0.9} />

      {/* Label */}
      <text
        x={x}
        y={y + 42}
        textAnchor="middle"
        className="fill-foreground text-[10px] font-mono"
      >
        {agent.name}
      </text>
      <text
        x={x}
        y={y + 54}
        textAnchor="middle"
        className="fill-muted-foreground text-[8px] font-mono uppercase"
      >
        {agent.state.replace('_', ' ')}
      </text>
    </g>
  );
};

interface LiveAgentMonitorProps {
  agents: Agent[];
  onAgentClick: (agent: Agent) => void;
}

const LiveAgentMonitor = ({ agents, onAgentClick }: LiveAgentMonitorProps) => {
  return (
    <div className="glass rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Live Agent Monitor</h3>
      </div>
      <div className="bg-background/50 rounded-lg overflow-hidden">
        <svg
          viewBox="0 0 580 300"
          className="w-full h-auto"
          style={{ minHeight: 260 }}
        >
          {/* Grid lines */}
          {[0, 1, 2, 3, 4, 5].map(i => (
            <line key={`v${i}`} x1={80 + i * 100} y1={0} x2={80 + i * 100} y2={300} stroke="hsl(225 15% 12%)" strokeWidth={0.5} />
          ))}
          {[0, 1, 2].map(i => (
            <line key={`h${i}`} x1={0} y1={60 + i * 100} x2={580} y2={60 + i * 100} stroke="hsl(225 15% 12%)" strokeWidth={0.5} />
          ))}

          {agents.map((agent, i) => (
            <AgentNode key={agent.id} agent={agent} index={i} onClick={onAgentClick} />
          ))}
        </svg>
      </div>
    </div>
  );
};

export default LiveAgentMonitor;
