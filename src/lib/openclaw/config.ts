const STORAGE_KEY = 'openclaw-config';

export interface OpenClawConfig {
  baseUrl: string;
  enabled: boolean;
}

const defaultConfig: OpenClawConfig = {
  baseUrl: 'http://localhost:3000',
  enabled: false,
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

export function saveConfig(config: OpenClawConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
