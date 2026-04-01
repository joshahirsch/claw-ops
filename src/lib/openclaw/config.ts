import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'openclaw-config';
const CONFIG_EVENT = 'openclaw-config-changed';

export type AuthMode = 'none' | 'bearer' | 'custom';

export interface OpenClawConfig {
  baseUrl: string;
  wsUrl: string;
  enabled: boolean;
  sessionKeys: string[];
  authMode: AuthMode;
  authToken: string;
  authHeaderName: string;
  authHeaderPrefix: string;
}

const defaultConfig: OpenClawConfig = {
  baseUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3000',
  enabled: false,
  sessionKeys: ['default'],
  authMode: 'none',
  authToken: '',
  authHeaderName: 'Authorization',
  authHeaderPrefix: 'Bearer ',
};

let cachedConfig: OpenClawConfig = defaultConfig;
let cachedRaw: string | null = null;

function readConfig(): OpenClawConfig {
  if (typeof window === 'undefined') return defaultConfig;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedConfig = raw ? { ...defaultConfig, ...JSON.parse(raw) } : defaultConfig;
    }
  } catch {
    // ignore
  }

  return cachedConfig;
}

function emitConfigChanged() {
  if (typeof window === 'undefined') return;
  // Invalidate cache before emitting so subscribers get the new value
  cachedRaw = null;
  window.dispatchEvent(new CustomEvent(CONFIG_EVENT));
}

export function getConfig(): OpenClawConfig {
  return readConfig();
}

export function saveConfig(config: Partial<OpenClawConfig>): void {
  const current = readConfig();
  const next = { ...current, ...config };

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  emitConfigChanged();
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handleChange = () => onStoreChange();
  window.addEventListener(CONFIG_EVENT, handleChange);
  window.addEventListener('storage', handleChange);

  return () => {
    window.removeEventListener(CONFIG_EVENT, handleChange);
    window.removeEventListener('storage', handleChange);
  };
}

export function useOpenClawConfig(): OpenClawConfig {
  return useSyncExternalStore(subscribe, readConfig, () => defaultConfig);
}
