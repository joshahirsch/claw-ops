import { CheckCircle, XCircle, Minus } from 'lucide-react';

interface HealthItem {
  label: string;
  status: 'connected' | 'disconnected' | 'degraded';
  detail: string;
}

const health: HealthItem[] = [
  { label: 'OpenClaw Connection', status: 'connected', detail: 'WebSocket active, latency 12ms' },
  { label: 'Gateway Status', status: 'connected', detail: 'All endpoints healthy' },
  { label: 'Session Stream', status: 'connected', detail: 'Streaming 8 active sessions' },
];

const tools = [
  { name: 'gmail.send', enabled: true },
  { name: 'gmail.draft', enabled: true },
  { name: 'gdrive.search', enabled: true },
  { name: 'gdrive.create', enabled: true },
  { name: 'calendar.read', enabled: true },
  { name: 'calendar.sync', enabled: false },
  { name: 'slack.message', enabled: true },
  { name: 'http.request', enabled: true },
  { name: 'sheets.read', enabled: true },
];

const skills = [
  { name: 'Email Composition', version: '2.1.0' },
  { name: 'Document Search', version: '1.8.3' },
  { name: 'Calendar Management', version: '1.5.1' },
  { name: 'Onboarding Workflow', version: '3.0.0' },
  { name: 'CRM Integration', version: '0.9.2' },
];

const statusIcon = (status: HealthItem['status']) => {
  switch (status) {
    case 'connected': return <CheckCircle className="w-4 h-4 text-success" />;
    case 'disconnected': return <XCircle className="w-4 h-4 text-destructive" />;
    case 'degraded': return <Minus className="w-4 h-4 text-warning" />;
  }
};

const SettingsPage = () => {
  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System configuration and health</p>
      </div>

      {/* Environment Health */}
      <div className="glass rounded-lg p-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Environment Health</h2>
        <div className="space-y-2">
          {health.map(item => (
            <div key={item.label} className="flex items-center justify-between p-3 rounded-md bg-background/50">
              <div className="flex items-center gap-3">
                {statusIcon(item.status)}
                <div>
                  <p className="text-sm text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
              </div>
              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                item.status === 'connected' ? 'bg-success/10 text-success border-success/20' :
                item.status === 'degraded' ? 'bg-warning/10 text-warning border-warning/20' :
                'bg-destructive/10 text-destructive border-destructive/20'
              }`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="glass rounded-lg p-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Tools Enabled</h2>
        <div className="flex flex-wrap gap-2">
          {tools.map(tool => (
            <span
              key={tool.name}
              className={`text-xs font-mono px-3 py-1.5 rounded-md border ${
                tool.enabled
                  ? 'bg-primary/5 text-primary/80 border-primary/20'
                  : 'bg-destructive/5 text-destructive/60 border-destructive/20 line-through'
              }`}
            >
              {tool.name}
            </span>
          ))}
        </div>
      </div>

      {/* Skills */}
      <div className="glass rounded-lg p-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Skills Installed</h2>
        <div className="space-y-1.5">
          {skills.map(skill => (
            <div key={skill.name} className="flex items-center justify-between p-2 rounded-md hover:bg-background/50 transition-colors">
              <span className="text-sm text-foreground">{skill.name}</span>
              <span className="text-[11px] font-mono text-muted-foreground">v{skill.version}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
