import type { JupyterServerConfig, ServerConnection } from '../types/jupyter';

const STORAGE_KEY = 'labnexus:jupyter-saved-servers';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSavedServerConfig(value: unknown): value is JupyterServerConfig {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.base_url === 'string'
  );
}

export function normalizeSavedServers(value: unknown): JupyterServerConfig[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSavedServerConfig);
}

export function upsertSavedServer(
  servers: JupyterServerConfig[],
  config: JupyterServerConfig
): JupyterServerConfig[] {
  const existingIndex = servers.findIndex((server) => server.id === config.id);
  if (existingIndex === -1) return [...servers, config];

  const updated = [...servers];
  updated[existingIndex] = config;
  return updated;
}

export function removeSavedServer(
  servers: JupyterServerConfig[],
  serverId: string
): JupyterServerConfig[] {
  return servers.filter((server) => server.id !== serverId);
}

export function toDisconnectedConnections(
  servers: JupyterServerConfig[]
): ServerConnection[] {
  return servers.map((config) => ({
    config,
    status: 'disconnected',
  }));
}

export function loadSavedServers(): JupyterServerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeSavedServers(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to load saved Jupyter servers:', error);
    return [];
  }
}

export const REDACTED_SERVER_SECRET = '••••••••';

export function redactServerSecretsForStorage(
  config: JupyterServerConfig
): JupyterServerConfig {
  return {
    ...config,
    token: config.token ? REDACTED_SERVER_SECRET : config.token,
    proxy: config.proxy
      ? {
          ...config.proxy,
          password: config.proxy.password
            ? REDACTED_SERVER_SECRET
            : config.proxy.password,
        }
      : config.proxy,
  };
}

export function saveServersToStorage(servers: JupyterServerConfig[]): void {
  const sanitized = servers.map(redactServerSecretsForStorage);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
}

export function saveServerConfig(config: JupyterServerConfig): JupyterServerConfig[] {
  const saved = upsertSavedServer(loadSavedServers(), config);
  saveServersToStorage(saved);
  return saved;
}

export function forgetServerConfig(serverId: string): JupyterServerConfig[] {
  const saved = removeSavedServer(loadSavedServers(), serverId);
  saveServersToStorage(saved);
  return saved;
}
