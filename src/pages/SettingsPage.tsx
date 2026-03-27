import { useState } from 'react';
import { CheckCircle, XCircle, Minus, Loader2, Wifi, WifiOff, ChevronDown } from 'lucide-react';
import { getConfig, saveConfig, type OpenClawConfig, type AuthMode } from '@/lib/openclaw/config';
import { testConnection, type TestConnectionResult } from '@/lib/openclaw/client';
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

const inputClass = "w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50";

const SettingsPage = () => {
  const [config, setConfig] = useState<OpenClawConfig>(getConfig);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'connected' | 'failed'>('untested');
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const health: HealthItem[] = [
    {
      label: 'OpenClaw Connection',
      status: config.enabled && connectionStatus === 'connected' ? 'connected' : config.enabled && connectionStatus === 'failed' ? 'disconnected' : 'disconnected',
      detail: config.enabled && connectionStatus === 'connected'
        ? `Connected, latency ${testResult?.latency}ms`
        : config.enabled && connectionStatus === 'failed'
          ? testResult?.error || 'Connection failed'
          : 'Not configured',
    },
    { label: 'Gateway Status', status: config.enabled && connectionStatus === 'connected' ? 'connected' : 'disconnected', detail: config.enabled ? config.baseUrl : 'No endpoint set' },
    { label: 'Session Stream', status: config.enabled && connectionStatus === 'connected' ? 'connected' : 'disconnected', detail: config.enabled ? 'SSE follow=1 ready' : 'Inactive' },
  ];

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      setTestResult(result);
      if (result.ok) {
        setConnectionStatus('connected');
        toast.success(`Connected to OpenClaw (${result.latency}ms)`);
      } else {
        setConnectionStatus('failed');
        toast.error(result.error || 'Could not reach OpenClaw');
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      setTestResult({ ok: false, latency: 0, error });
      setConnectionStatus('failed');
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
      setTestResult(null);
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
            <label className="text-xs text-muted-foreground font-mono block mb-1">Base URL (HTTP)</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://linux-process-las-talk.trycloudflare.com"
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground font-mono block mb-1">WebSocket URL</label>
            <input
              type="text"
              value={config.wsUrl}
              onChange={(e) => setConfig({ ...config, wsUrl: e.target.value })}
              placeholder="ws://localhost:3000"
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground font-mono block mb-1">Session Keys (comma-separated)</label>
            <input
              type="text"
              value={config.sessionKeys.join(', ')}
              onChange={(e) => setConfig({ ...config, sessionKeys: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              placeholder="agent:main:main"
              className={inputClass}
            />
          </div>

          {/* Auth Configuration */}
          <div className="border-t border-border pt-3 mt-3">
            <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Authentication</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground font-mono block mb-1">Auth Mode</label>
                <div className="relative">
                  <select
                    value={config.authMode}
                    onChange={(e) => setConfig({ ...config, authMode: e.target.value as AuthMode })}
                    className={`${inputClass} appearance-none pr-8`}
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="custom">Custom Header</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {config.authMode !== 'none' && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground font-mono block mb-1">Token</label>
                    <input
                      type="password"
                      value={config.authToken}
                      onChange={(e) => setConfig({ ...config, authToken: e.target.value })}
                      placeholder="your-auth-token"
                      className={inputClass}
                    />
                  </div>

                  {config.authMode === 'custom' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground font-mono block mb-1">Header Name</label>
                        <input
                          type="text"
                          value={config.authHeaderName}
                          onChange={(e) => setConfig({ ...config, authHeaderName: e.target.value })}
                          placeholder="Authorization"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground font-mono block mb-1">Header Prefix</label>
                        <input
                          type="text"
                          value={config.authHeaderPrefix}
                          onChange={(e) => setConfig({ ...config, authHeaderPrefix: e.target.value })}
                          placeholder="Bearer "
                          className={inputClass}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2">
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
              Test Connection
            </button>
          </div>

          {/* Test Connection Response Panel */}
          {testResult && (
            <div className={`rounded-md border p-3 text-xs font-mono space-y-1.5 ${
              testResult.ok
                ? 'bg-success/10 border-success/20'
                : 'bg-destructive/10 border-destructive/20'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {testResult.ok ? <CheckCircle className="w-3.5 h-3.5 text-success" /> : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                <span className={testResult.ok ? 'text-success' : 'text-destructive'}>
                  {testResult.ok ? 'Connection successful' : 'Connection failed'}
                </span>
              </div>

              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                <span>Status:</span>
                <span className="text-foreground">
                  {testResult.status ? `${testResult.status} ${testResult.statusText || ''}` : 'N/A'}
                </span>

                <span>Latency:</span>
                <span className="text-foreground">{testResult.latency}ms</span>

                <span>Endpoint:</span>
                <span className="text-foreground truncate">{testResult.endpoint || 'N/A'}</span>

                <span>Auth applied:</span>
                <span className="text-foreground">
                  {testResult.authApplied ? `Yes (${testResult.authMode})` : 'No'}
                </span>

                {testResult.bodySnippet && (
                  <>
                    <span>Response:</span>
                    <pre className="text-foreground whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                      {testResult.bodySnippet.slice(0, 300)}
                    </pre>
                  </>
                )}

                {testResult.error && (
                  <>
                    <span>Error:</span>
                    <span className="text-destructive">{testResult.error}</span>
                  </>
                )}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            All requests are routed through a server-side proxy to handle auth headers and avoid CORS issues.
            Point the Base URL to your OpenClaw tunnel (e.g. <span className="font-mono text-primary/70">cloudflared</span>).
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
