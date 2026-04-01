import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Minus, Loader2, Wifi, WifiOff, ChevronDown, Activity, Zap, HeartPulse, Search } from 'lucide-react';
import { saveConfig, type OpenClawConfig, type AuthMode, useOpenClawConfig } from '@/lib/openclaw/config';
import { runBasicProbe, runEchoProbe, runHealthProbe, runSSEProbe, type ProbeResult } from '@/lib/openclaw/client';
import { toast } from 'sonner';

interface HealthItem {
  label: string;
  status: 'connected' | 'disconnected' | 'degraded';
  detail: string;
}

interface DiagnosticsState {
  connectionStatus: 'untested' | 'connected' | 'failed';
  basicResult: ProbeResult | null;
  sseResult: ProbeResult | null;
  healthResult: ProbeResult | null;
  echoResult: ProbeResult | null;
}

const DIAGNOSTICS_STORAGE_KEY = 'openclaw-diagnostics';
const MAX_DIAGNOSTIC_CHARS = 4000;

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

const emptyDiagnostics: DiagnosticsState = {
  connectionStatus: 'untested',
  basicResult: null,
  sseResult: null,
  healthResult: null,
  echoResult: null,
};

const statusIcon = (status: HealthItem['status']) => {
  switch (status) {
    case 'connected': return <CheckCircle className="w-4 h-4 text-success" />;
    case 'disconnected': return <XCircle className="w-4 h-4 text-destructive" />;
    case 'degraded': return <Minus className="w-4 h-4 text-warning" />;
  }
};

const inputClass = 'w-full px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50';

const prettyPrint = (value: unknown) => JSON.stringify(value, null, 2);

function loadDiagnosticsState(): DiagnosticsState {
  if (typeof window === 'undefined') return emptyDiagnostics;

  try {
    const raw = window.localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return emptyDiagnostics;
    return { ...emptyDiagnostics, ...JSON.parse(raw) };
  } catch {
    return emptyDiagnostics;
  }
}

function saveDiagnosticsState(value: DiagnosticsState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(value));
}

const DiagnosticsBlock = ({ label, value }: { label: string; value: unknown }) => {
  const [expanded, setExpanded] = useState(false);

  if (value === undefined || value === null) return null;

  const text = typeof value === 'string' ? value : prettyPrint(value);
  const isLong = text.length > MAX_DIAGNOSTIC_CHARS;
  const displayText = expanded || !isLong
    ? text
    : `${text.slice(0, MAX_DIAGNOSTIC_CHARS)}\n… [truncated ${text.length - MAX_DIAGNOSTIC_CHARS} chars]`;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}:</span>
        {isLong && (
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[11px] text-primary hover:text-primary/80 transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      <pre className="mt-1 p-2 rounded bg-background/80 border border-border whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-foreground">
        {displayText}
      </pre>
    </div>
  );
};

const DiagRow = ({ label, value, error }: { label: string; value: React.ReactNode; error?: boolean }) => (
  <>
    <span className="text-muted-foreground select-none">{label}:</span>
    <span className={error ? 'text-destructive' : 'text-foreground'}>{value ?? 'N/A'}</span>
  </>
);

const ProbeDiagnostics = ({ result, probeType }: { result: ProbeResult; probeType: string }) => {
  const statusColor = result.ok ? 'border-success/20 bg-success/5' : 'border-destructive/20 bg-destructive/5';
  const statusLabel = result.ok
    ? `✓ ${probeType} probe passed`
    : result.message || result.errorLabel || result.clientError || `✗ ${probeType} probe failed`;

  return (
    <div className={`rounded-md border p-3 text-xs font-mono space-y-2 ${statusColor}`}>
      <div className="flex items-center gap-2 font-semibold">
        {result.ok
          ? <CheckCircle className="w-3.5 h-3.5 text-success shrink-0" />
          : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
        <span className={result.ok ? 'text-success' : 'text-destructive'}>{statusLabel}</span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <DiagRow label="Probe type" value={probeType} />
        <DiagRow label="Request method" value={result.requestMethod} />
        <DiagRow label="Stage" value={result.stage} error={!result.ok && !!result.stage} />
        <DiagRow label="Failure point" value={result.failurePoint} error={!result.ok && !!result.failurePoint} />
        <DiagRow label="Proxy URL" value={<span className="break-all">{result.proxyUrl}</span>} />
        <DiagRow label="Proxy route invoked" value={<span className="break-all">{result.proxyRouteInvoked}</span>} />
        <DiagRow label="Upstream URL" value={<span className="break-all">{result.upstreamUrl || result.endpoint}</span>} />
        <DiagRow label="Session key (raw)" value={result.sessionKeyRaw} />
        <DiagRow label="Session key (encoded)" value={result.sessionKeyEncoded} />
        <DiagRow label="Auth mode" value={result.authMode || 'none'} />
        <DiagRow label="Auth header attached" value={typeof result.authApplied === 'boolean' ? (result.authApplied ? 'Yes' : 'No') : 'N/A'} />
        <DiagRow
          label="Function HTTP status"
          value={result.proxyHttpStatus !== undefined ? `${result.proxyHttpStatus} ${result.proxyStatusText || ''}` : 'N/A'}
          error={!!result.proxyHttpStatus && result.proxyHttpStatus >= 400}
        />
        <DiagRow
          label="Upstream HTTP status"
          value={result.upstreamStatus !== undefined ? `${result.upstreamStatus} ${result.statusText || ''}` : 'N/A'}
          error={!!result.upstreamStatus && result.upstreamStatus >= 400}
        />
        <DiagRow label="Error type" value={result.errorType || result.clientErrorType} error={!!(result.errorType || result.clientErrorType)} />
        <DiagRow label="Error label" value={result.errorLabel || result.message} error={!!(result.errorLabel || result.message)} />
        <DiagRow label="Latency" value={result.latencyMs !== undefined ? `${result.latencyMs}ms` : 'N/A'} />
        <DiagRow label="OPTIONS hit" value={typeof result.optionsHit === 'boolean' ? (result.optionsHit ? 'Yes' : 'No') : 'N/A'} />
        {result.clientError && <DiagRow label="Client error" value={result.clientError} error />}
      </div>

      <DiagnosticsBlock label="Browser request headers sent" value={result.requestHeadersSent} />
      <DiagnosticsBlock label="Function headers received" value={result.headersReceived || result.diagnostics?.headersReceived} />
      <DiagnosticsBlock label="Query params received" value={result.queryParamsReceived || result.diagnostics?.queryParamsReceived} />
      <DiagnosticsBlock label="Request body received" value={result.requestBodyReceived || result.diagnostics?.requestBodyReceived} />
      <DiagnosticsBlock label="Response body snippet" value={result.bodySnippet} />
      <DiagnosticsBlock label="Parsed JSON" value={result.parsedBody} />
      <DiagnosticsBlock label="Raw error object" value={result.rawErrorObject} />
      <DiagnosticsBlock label="Raw proxy diagnostics" value={result.diagnostics} />
    </div>
  );
};

const SettingsPage = () => {
  const savedConfig = useOpenClawConfig();
  const [config, setConfig] = useState<OpenClawConfig>(savedConfig);
  const [probing, setProbing] = useState<'basic' | 'sse' | 'health' | 'echo' | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<DiagnosticsState['connectionStatus']>(() => loadDiagnosticsState().connectionStatus);
  const [basicResult, setBasicResult] = useState<ProbeResult | null>(() => loadDiagnosticsState().basicResult);
  const [sseResult, setSSEResult] = useState<ProbeResult | null>(() => loadDiagnosticsState().sseResult);
  const [healthResult, setHealthResult] = useState<ProbeResult | null>(() => loadDiagnosticsState().healthResult);
  const [echoResult, setEchoResult] = useState<ProbeResult | null>(() => loadDiagnosticsState().echoResult);

  useEffect(() => {
    setConfig(savedConfig);
  }, [savedConfig]);

  useEffect(() => {
    saveDiagnosticsState({ connectionStatus, basicResult, sseResult, healthResult, echoResult });
  }, [connectionStatus, basicResult, sseResult, healthResult, echoResult]);

  const updateConfig = (patch: Partial<OpenClawConfig>) => setConfig((prev) => ({ ...prev, ...patch }));

  const sessionKey = config.sessionKeys[0] || 'test';
  const hasSavedConnection = savedConfig.enabled && Boolean(savedConfig.baseUrl);
  const hasWorkingBasic = Boolean(basicResult?.ok);
  const hasWorkingSSE = Boolean(sseResult?.ok);
  const hasWorkingProxy = Boolean(healthResult?.ok);

  const health: HealthItem[] = [
    {
      label: 'OpenClaw Connection',
      status: !savedConfig.enabled
        ? 'disconnected'
        : hasWorkingBasic || connectionStatus === 'connected'
          ? 'connected'
          : connectionStatus === 'failed'
            ? 'disconnected'
            : 'degraded',
      detail: !savedConfig.enabled
        ? 'Not configured'
        : hasWorkingBasic || connectionStatus === 'connected'
          ? `Connected${basicResult?.latencyMs ? `, latency ${basicResult.latencyMs}ms` : ''}`
          : connectionStatus === 'failed'
            ? basicResult?.message || basicResult?.errorLabel || basicResult?.clientError || 'Connection failed'
            : 'Configured, awaiting verification',
    },
    {
      label: 'Gateway Status',
      status: !savedConfig.enabled
        ? 'disconnected'
        : hasWorkingProxy
          ? 'connected'
          : hasSavedConnection
            ? 'degraded'
            : 'disconnected',
      detail: !savedConfig.enabled
        ? 'No endpoint set'
        : hasWorkingProxy
          ? 'Proxy reachable'
          : savedConfig.baseUrl || 'Configured, proxy not yet tested',
    },
    {
      label: 'Session Stream',
      status: !savedConfig.enabled
        ? 'disconnected'
        : hasWorkingSSE
          ? 'connected'
          : hasWorkingBasic
            ? 'degraded'
            : 'disconnected',
      detail: !savedConfig.enabled
        ? 'Untested'
        : hasWorkingSSE
          ? 'SSE follow=1 OK'
          : hasWorkingBasic
            ? 'Configured, SSE not yet verified'
            : 'Untested',
    },
  ];

  const handleBasicProbe = async () => {
    setProbing('basic');
    setBasicResult(null);
    try {
      const result = await runBasicProbe(sessionKey);
      setBasicResult(result);
      setConnectionStatus(result.ok ? 'connected' : 'failed');
      if (result.ok) {
        toast.success(`Basic probe passed (${result.latencyMs}ms)`);
      } else {
        toast.error(result.message || result.errorLabel || result.clientError || 'Basic probe failed');
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      setBasicResult({ ok: false, clientError: error, clientErrorType: 'exception' });
      setConnectionStatus('failed');
    }
    setProbing(null);
  };

  const handleSSEProbe = async () => {
    setProbing('sse');
    setSSEResult(null);
    try {
      const result = await runSSEProbe(sessionKey);
      setSSEResult(result);
      if (result.ok) {
        toast.success(`SSE probe passed (${result.latencyMs}ms)`);
      } else {
        toast.error(result.message || result.errorLabel || result.clientError || 'SSE probe failed');
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      setSSEResult({ ok: false, clientError: error, clientErrorType: 'exception', failurePoint: 'sse_stream_init' });
    }
    setProbing(null);
  };

  const handleHealthProbe = async () => {
    setProbing('health');
    setHealthResult(null);
    try {
      const result = await runHealthProbe();
      setHealthResult(result);
      if (result.ok) {
        toast.success(`Proxy reachable (${result.latencyMs}ms)`);
      } else {
        toast.error(result.message || result.clientError || `Proxy returned ${result.proxyHttpStatus}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      setHealthResult({ ok: false, clientError: error, clientErrorType: 'exception', failurePoint: 'proxy_health' });
    }
    setProbing(null);
  };

  const handleEchoProbe = async () => {
    setProbing('echo');
    setEchoResult(null);
    try {
      const result = await runEchoProbe();
      setEchoResult(result);
      if (result.ok) {
        toast.success('Echo probe captured browser request details');
      } else {
        toast.error(result.message || result.errorLabel || result.clientError || 'Echo probe failed');
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      setEchoResult({ ok: false, clientError: error, clientErrorType: 'exception', failurePoint: 'echo_probe' });
    }
    setProbing(null);
  };

  const handleSave = () => {
    saveConfig(config);
    toast.success('Configuration saved');
  };

  const handleToggle = () => {
    const next = { ...config, enabled: !config.enabled };
    setConfig(next);
    saveConfig(next);

    if (!next.enabled) {
      setConnectionStatus('untested');
      setBasicResult(null);
      setSSEResult(null);
      setEchoResult(null);
      setHealthResult(null);
      saveDiagnosticsState(emptyDiagnostics);
      toast.info('OpenClaw disconnected — using demo data');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System configuration and health</p>
      </div>

      <div className="glass rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {config.enabled ? <Wifi className="w-4 h-4 text-success" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />}
            <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">OpenClaw Connection</h2>
          </div>
          <button onClick={handleToggle} className={`relative w-10 h-5 rounded-full transition-colors ${config.enabled ? 'bg-success' : 'bg-muted'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-foreground transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground font-mono block mb-1">Base URL (HTTP)</label>
            <input type="text" value={config.baseUrl} onChange={(e) => updateConfig({ baseUrl: e.target.value })} placeholder="https://linux-process-las-talk.trycloudflare.com" className={inputClass} />
          </div>

          <div>
            <label className="text-xs text-muted-foreground font-mono block mb-1">WebSocket URL</label>
            <input type="text" value={config.wsUrl} onChange={(e) => updateConfig({ wsUrl: e.target.value })} placeholder="ws://localhost:3000" className={inputClass} />
          </div>

          <div>
            <label className="text-xs text-muted-foreground font-mono block mb-1">Session Keys (comma-separated)</label>
            <input type="text" value={config.sessionKeys.join(', ')} onChange={(e) => updateConfig({ sessionKeys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="agent:main:main" className={inputClass} />
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Authentication</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground font-mono block mb-1">Auth Mode</label>
                <div className="relative">
                  <select value={config.authMode} onChange={(e) => updateConfig({ authMode: e.target.value as AuthMode })} className={`${inputClass} appearance-none pr-8`}>
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
                    <input type="password" value={config.authToken} onChange={(e) => updateConfig({ authToken: e.target.value })} placeholder="your-auth-token" className={inputClass} />
                  </div>

                  {config.authMode === 'custom' && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground font-mono block mb-1">Header Name</label>
                        <input type="text" value={config.authHeaderName} onChange={(e) => updateConfig({ authHeaderName: e.target.value })} placeholder="Authorization" className={inputClass} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground font-mono block mb-1">Header Prefix</label>
                        <input type="text" value={config.authHeaderPrefix} onChange={(e) => updateConfig({ authHeaderPrefix: e.target.value })} placeholder="Bearer " className={inputClass} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleSave} className="px-3 py-2 rounded-md bg-primary/10 text-primary text-xs font-mono border border-primary/20 hover:bg-primary/20 transition-colors">Save</button>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">Diagnostics now send only standard browser headers to the proxy and render exactly what the browser sent versus what the function received.</p>
        </div>
      </div>

      <div className="glass rounded-lg p-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Connection Diagnostics</h2>
        <p className="text-xs text-muted-foreground mb-3">Run probes to isolate browser request shape, proxy reachability, and upstream history fetch behavior. Session key: <span className="font-mono text-foreground">{sessionKey}</span></p>

        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={handleHealthProbe} disabled={probing !== null} className="px-3 py-2 rounded-md bg-primary/10 text-primary text-xs font-mono border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {probing === 'health' ? <Loader2 className="w-3 h-3 animate-spin" /> : <HeartPulse className="w-3 h-3" />}
            Test Proxy Only
          </button>
          <button onClick={handleEchoProbe} disabled={probing !== null} className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono border border-border hover:bg-secondary/80 transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {probing === 'echo' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Run Echo Probe
          </button>
          <button onClick={handleBasicProbe} disabled={probing !== null || !config.enabled} className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono border border-border hover:bg-secondary/80 transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {probing === 'basic' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
            Run Basic Probe
          </button>
          <button onClick={handleSSEProbe} disabled={probing !== null || !config.enabled} className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-mono border border-border hover:bg-secondary/80 transition-colors disabled:opacity-40 flex items-center gap-1.5">
            {probing === 'sse' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Run SSE Probe
          </button>
        </div>

        {!config.enabled && <p className="text-xs text-muted-foreground italic">Enable the OpenClaw connection above to run upstream probes. Proxy-only and echo probes work regardless.</p>}

        <div className="space-y-3">
          {healthResult && <ProbeDiagnostics result={healthResult} probeType="Proxy health" />}
          {echoResult && <ProbeDiagnostics result={echoResult} probeType="Echo request" />}
          {basicResult && <ProbeDiagnostics result={basicResult} probeType="Basic (history)" />}
          {sseResult && <ProbeDiagnostics result={sseResult} probeType="SSE (follow=1)" />}
        </div>
      </div>

      <div className="glass rounded-lg p-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Environment Health</h2>
        <div className="space-y-2">
          {health.map((item) => (
            <div key={item.label} className="flex items-center justify-between p-3 rounded-md bg-background/50">
              <div className="flex items-center gap-3">
                {statusIcon(item.status)}
                <div>
                  <p className="text-sm text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
              </div>
              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${item.status === 'connected' ? 'bg-success/10 text-success border-success/20' : item.status === 'degraded' ? 'bg-warning/10 text-warning border-warning/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass rounded-lg p-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Tools Enabled</h2>
        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => (
            <span key={tool.name} className={`text-xs font-mono px-3 py-1.5 rounded-md border ${tool.enabled ? 'bg-primary/5 text-primary/80 border-primary/20' : 'bg-destructive/5 text-destructive/60 border-destructive/20 line-through'}`}>
              {tool.name}
            </span>
          ))}
        </div>
      </div>

      <div className="glass rounded-lg p-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Skills Installed</h2>
        <div className="space-y-1.5">
          {skills.map((skill) => (
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
