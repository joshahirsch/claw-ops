import { useState } from 'react';
import { mockReplaySessions } from '@/data/mockData';
import { Play, CheckCircle, XCircle, Bot, Wrench, ShieldCheck, Brain, AlertTriangle } from 'lucide-react';
import { ReplaySession } from '@/data/types';

const stepIcons: Record<string, typeof Bot> = {
  thinking: Brain,
  tool_use: Wrench,
  approval: ShieldCheck,
  complete: CheckCircle,
  error: AlertTriangle,
};

const ReplayPage = () => {
  const [selected, setSelected] = useState<ReplaySession | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  const handleSelect = (session: ReplaySession) => {
    setSelected(session);
    setCurrentStep(0);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Replay</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Review completed runs step by step</p>
      </div>

      {/* Session List */}
      <div className="grid grid-cols-2 gap-3">
        {mockReplaySessions.map(session => (
          <button
            key={session.id}
            onClick={() => handleSelect(session)}
            className={`glass rounded-lg p-4 text-left transition-all hover:border-primary/30 ${selected?.id === session.id ? 'border-primary/40 bg-primary/5' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{session.task}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{session.agentName}</p>
              </div>
              {session.status === 'completed' ? (
                <CheckCircle className="w-4 h-4 text-success shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] font-mono text-muted-foreground">
              <span>{session.startTime} → {session.endTime}</span>
              <span>{session.steps.length} steps</span>
            </div>
          </button>
        ))}
      </div>

      {/* Replay View */}
      {selected && (
        <div className="glass rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{selected.task}</h3>
              <p className="text-xs text-muted-foreground">{selected.agentName} · {selected.startTime} → {selected.endTime}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                disabled={currentStep === 0}
                className="px-3 py-1.5 rounded-md bg-secondary text-xs text-secondary-foreground disabled:opacity-30 hover:bg-secondary/80 transition-colors"
              >
                ← Prev
              </button>
              <span className="text-xs font-mono text-muted-foreground px-2">
                {currentStep + 1} / {selected.steps.length}
              </span>
              <button
                onClick={() => setCurrentStep(Math.min(selected.steps.length - 1, currentStep + 1))}
                disabled={currentStep === selected.steps.length - 1}
                className="px-3 py-1.5 rounded-md bg-secondary text-xs text-secondary-foreground disabled:opacity-30 hover:bg-secondary/80 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>

          {/* Scrubber */}
          <div className="relative mb-6">
            <div className="h-1 bg-secondary rounded-full">
              <div
                className="h-1 bg-primary rounded-full transition-all duration-300"
                style={{ width: `${((currentStep + 1) / selected.steps.length) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              {selected.steps.map((step, i) => {
                const Icon = stepIcons[step.type] || Play;
                return (
                  <button
                    key={step.id}
                    onClick={() => setCurrentStep(i)}
                    className={`flex flex-col items-center gap-1 transition-all ${i <= currentStep ? 'opacity-100' : 'opacity-30'}`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${i === currentStep ? 'bg-primary/20 ring-1 ring-primary' : 'bg-secondary'}`}>
                      <Icon className={`w-3 h-3 ${i === currentStep ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Step Detail */}
          <div className="bg-background/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              {(() => {
                const step = selected.steps[currentStep];
                const Icon = stepIcons[step.type] || Play;
                return (
                  <>
                    <Icon className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{step.description}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] font-mono text-muted-foreground">{step.timestamp}</span>
                        {step.tool && <span className="text-[11px] font-mono text-accent/70">{step.tool}</span>}
                        <span className="text-[11px] font-mono text-muted-foreground">{step.duration}</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReplayPage;
