import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Minus, Loader2, Wifi, WifiOff } from 'lucide-react';
import { getConfig, saveConfig, type OpenClawConfig } from '@/lib/openclaw/config';
import { testConnection } from '@/lib/openclaw/client';
import { toast } from 'sonner';

interface HealthItem {
  label: string;
  status: 'connected' | 'disconnected' | 'degraded';
  detail: string;
}

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
  const [config, setConfig] = useState<OpenClawConfig>(getConfig);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'connected' | 'failed'>('untested');
  const [latency, setLatency] = useState<number | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  const health: HealthItem[] = [
    {
      label: 'OpenClaw Connection',
      status: config.enabled && connectionStatus === 'connected' ? 'connected' : config.enabled && connectionStatus === 'failed' ? 'disconnected' : 'disconnected',
      detail: config.enabled && connectionStatus === 'connected'
        ? `Connected, latency ${latency}ms`
        : config.enabled && connectionStatus === 'failed'
          ? connError || 'Connection failed'
          : 'Not configured',
    },
    { label: 'Gateway Status', status: config.enabled && connectionStatus === 'connected' ? 'connected' : 'disconnected', detail: config.enabled ? config.baseUrl : 'No endpoint set' },
    { label: 'Session Stream', status: config.enabled && connectionStatus === 'connected' ? 'connected' : 'disconnected', detail: config.enabled ? 'SSE follow=1 ready' : 'Inactive' },
  ];

  const handleTest = async () => {
    setTesting(true);
    setConnError(null);
    try {
      const result = await testConnection();
      setLatency(result.latency);
      if (result.ok) {
        setConnectionStatus('connected');
        toast.success(`Connected to OpenClaw (${result.latency}ms)`);
      } else {
        setConnectionStatus('failed');
        setConnError(result.error || 'Unreachable');
        toast.error(result.error || 'Could not reach OpenClaw');
      }
    } catch (e) {
      setConnectionStatus('failed');
      setConnError(e instanceof Error ? e.message : 'Unknown error');
      toast.error('Connection test failed');
    }
    setTesting(false);
  };

  const handleSave = () => {
    saveConfig(config);
    toast.success('Configuration saved');
    if (config.enabled) handleTest();
  };

  const handleToggle = () => {
    const next = { ...config, enabled: !config.enabled };
    setConfig(next);
    saveConfig(next);
    if (!next.enabled) {
      setConnectionStatus('untested');
      toast.info('OpenClaw disconnected — using demo data');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System configuration and health</p>
      </div>

      {/* OpenClaw Connection */}
      <div className="glass rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {config.enabled ? <Wifi className="w-4 h-4 text-success" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />}
            <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">OpenClaw Connection</h2>
          </div>
          <button
            onClick={handleToggle}
            className={`relative w-10 h-5 rounded-full transition-colors ${config.enabled ? 'bg-success' : 'bg-muted'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-foreground transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground font-mono block mb-1">Base URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="http://localhost:3000"
                className="flex-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <button
                onClick={handleSave}
                className="px-3 py-2 rounded-md bg-primary/10 text-primary text-xs font-mono border border-primary/20 hover:bg-primary/20 transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !config.enabled}
                className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono border border-border hover:bg-secondary/80 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Test
              </button>
            </div>
          </div>

          {connectionStatus !== 'untested' && (
            <div className={`flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-md border ${
              connectionStatus === 'connected'
                ? 'bg-success/10 text-success border-success/20'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            }`}>
              {connectionStatus === 'connected' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              {connectionStatus === 'connected' ? `Connected — ${latency}ms latency` : connError}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Point this to your local OpenClaw instance. Use <span className="font-mono text-primary/70">ngrok</span> or{' '}
            <span className="font-mono text-primary/70">cloudflared</span> if running remotely. 
            The app uses <span className="font-mono text-primary/70">GET /sessions/&#123;key&#125;/history?follow=1</span> for live SSE streaming.
          </p>
        </div>
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
