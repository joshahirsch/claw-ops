const STORAGE_KEY = 'openclaw-config';

export interface OpenClawConfig {
  baseUrl: string;
  wsUrl: string;
  enabled: boolean;
  sessionKeys: string[]; // which sessions to monitor
}

const defaultConfig: OpenClawConfig = {
  baseUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3000',
  enabled: false,
  sessionKeys: ['default'],
};

export function getConfig(): OpenClawConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaultConfig;
}

export function saveConfig(config: Partial<OpenClawConfig>): void {
  const current = getConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...config }));
}
