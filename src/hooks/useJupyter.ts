/**
 * useJupyter — Hook for managing Jupyter server connections.
 */

import { useState, useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type {
  JupyterServerConfig,
  JupyterHubLoginConfig,
  ServerConnection,
  ConnectionStatus,
  JupyterConnectionEvent,
} from '../types/jupyter';
import {
  jupyterConnect,
  jupyterHubLogin,
  jupyterDisconnect,
  jupyterListServers,
  jupyterSetActive,
} from '../services/tauriIpc';
import {
  forgetServerConfig,
  loadSavedServers,
  saveServerConfig,
  toDisconnectedConnections,
} from './jupyterServerStorage';

interface UseJupyterReturn {
  /** All server connections */
  servers: ServerConnection[];
  /** ID of the active server */
  activeServerId: string | null;
  /** Whether any connection operation is in progress */
  isConnecting: boolean;
  /** Last error message */
  error: string | null;
  /** Connect to a Jupyter server */
  connect: (config: JupyterServerConfig) => Promise<void>;
  /** Connect to a JupyterHub/TLJH server via login */
  connectHub: (config: JupyterHubLoginConfig) => Promise<void>;
  /** Disconnect from a server */
  disconnect: (serverId: string) => Promise<void>;
  /** Reconnect to a saved server */
  reconnect: (serverId: string) => Promise<void>;
  /** Forget a saved server and remove it from the list */
  forget: (serverId: string) => void;
  /** Set the active server */
  setActive: (serverId: string) => Promise<void>;
  /** Refresh the server list */
  refresh: () => Promise<void>;
  /** Clear the error */
  clearError: () => void;
}

export function useJupyter(): UseJupyterReturn {
  const [servers, setServers] = useState<ServerConnection[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setServers(toDisconnectedConnections(loadSavedServers()));
  }, []);

  // Listen for connection status events from the Rust backend
  useEffect(() => {
    const unlisten = listen<JupyterConnectionEvent>(
      'jupyter:connection',
      (event) => {
        const { server_id, status, message } = event.payload;
        setServers((prev) =>
          prev.map((s) =>
            s.config.id === server_id
              ? {
                  ...s,
                  status: status as ConnectionStatus,
                  error_message: message,
                }
              : s
          )
        );
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await jupyterListServers();
      setServers(list);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  const connect = useCallback(
    async (config: JupyterServerConfig) => {
      setIsConnecting(true);
      setError(null);
      try {
        const connection = await jupyterConnect(config);
        saveServerConfig(connection.config);
        setServers((prev) => {
          const existing = prev.findIndex((s) => s.config.id === config.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = connection;
            return updated;
          }
          return [...prev, connection];
        });
        // Set as active if first connection
        if (!activeServerId) {
          setActiveServerId(config.id);
        }
      } catch (e: unknown) {
        const msg =
          typeof e === 'object' && e !== null && 'message' in e
            ? (e as { message: string }).message
            : String(e);
        setError(msg);
      } finally {
        setIsConnecting(false);
      }
    },
    [activeServerId]
  );

  const connectHub = useCallback(
    async (config: JupyterHubLoginConfig) => {
      setIsConnecting(true);
      setError(null);
      try {
        const connection = await jupyterHubLogin(config);
        saveServerConfig(connection.config);
        setServers((prev) => {
          const existing = prev.findIndex((s) => s.config.id === connection.config.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = connection;
            return updated;
          }
          return [...prev, connection];
        });
        if (!activeServerId) {
          setActiveServerId(connection.config.id);
        }
      } catch (e: unknown) {
        const msg =
          typeof e === 'object' && e !== null && 'message' in e
            ? (e as { message: string }).message
            : String(e);
        setError(msg);
      } finally {
        setIsConnecting(false);
      }
    },
    [activeServerId]
  );

  const disconnect = useCallback(
    async (serverId: string) => {
      try {
        await jupyterDisconnect(serverId);
        setServers((prev) =>
          prev.map((server) =>
            server.config.id === serverId
              ? { ...server, status: 'disconnected' as ConnectionStatus }
              : server
          )
        );
        if (activeServerId === serverId) {
          setActiveServerId(null);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    },
    [activeServerId]
  );

  const reconnect = useCallback(
    async (serverId: string) => {
      const savedServer = servers.find((server) => server.config.id === serverId);
      if (!savedServer) return;
      await connect(savedServer.config);
      setActiveServerId(serverId);
    },
    [connect, servers]
  );

  const forget = useCallback(
    (serverId: string) => {
      forgetServerConfig(serverId);
      setServers((prev) => prev.filter((server) => server.config.id !== serverId));
      if (activeServerId === serverId) {
        setActiveServerId(null);
      }
    },
    [activeServerId]
  );

  const setActive = useCallback(async (serverId: string) => {
    try {
      await jupyterSetActive(serverId);
      setActiveServerId(serverId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    servers,
    activeServerId,
    isConnecting,
    error,
    connect,
    connectHub,
    disconnect,
    reconnect,
    forget,
    setActive,
    refresh,
    clearError,
  };
}
