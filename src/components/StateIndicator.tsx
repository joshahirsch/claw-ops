import { AgentState } from '@/data/types';

interface StateIndicatorProps {
  state: AgentState;
  size?: 'sm' | 'md' | 'lg';
}

const stateConfig: Record<AgentState, { label: string; color: string; bgColor: string; borderColor: string }> = {
  idle: { label: 'Idle', color: 'text-muted-foreground', bgColor: 'bg-muted-foreground/10', borderColor: 'border-muted-foreground/20' },
  thinking: { label: 'Thinking', color: 'text-primary', bgColor: 'bg-primary/10', borderColor: 'border-primary/30' },
  tool_active: { label: 'Tool Active', color: 'text-accent', bgColor: 'bg-accent/10', borderColor: 'border-accent/30' },
  multi_step: { label: 'Multi-Step', color: 'text-primary', bgColor: 'bg-primary/10', borderColor: 'border-primary/30' },
  awaiting_approval: { label: 'Awaiting Approval', color: 'text-warning', bgColor: 'bg-warning/10', borderColor: 'border-warning/30' },
  error: { label: 'Error', color: 'text-destructive', bgColor: 'bg-destructive/10', borderColor: 'border-destructive/30' },
  stalled: { label: 'Stalled', color: 'text-warning', bgColor: 'bg-warning/10', borderColor: 'border-warning/30' },
  complete: { label: 'Complete', color: 'text-success', bgColor: 'bg-success/10', borderColor: 'border-success/30' },
};

const StateIndicator = ({ state, size = 'sm' }: StateIndicatorProps) => {
  const config = stateConfig[state];
  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-medium uppercase tracking-wider ${config.color} ${config.bgColor} ${config.borderColor} ${sizeClasses[size]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${state === 'idle' ? 'bg-muted-foreground/50' : state === 'error' ? 'bg-destructive animate-pulse' : state === 'thinking' ? 'bg-primary animate-pulse' : state === 'awaiting_approval' || state === 'stalled' ? 'bg-warning animate-pulse' : state === 'complete' ? 'bg-success' : 'bg-accent animate-pulse'}`} />
      {config.label}
    </span>
  );
};

export { stateConfig };
export default StateIndicator;
