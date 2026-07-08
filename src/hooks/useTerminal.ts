/**
 * useTerminal — Hook for managing remote Jupyter Terminal WebSocket sessions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  jupyterConnectTerminal,
  jupyterDisconnectTerminal,
  jupyterSendTerminalInput,
  jupyterResizeTerminal,
} from '../services/tauriIpc';

interface UseTerminalProps {
  serverId?: string;
  terminalName: string;
  onData?: (data: string) => void;
}

interface UseTerminalReturn {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendInput: (data: string) => Promise<void>;
  resize: (rows: number, cols: number) => Promise<void>;
}

export function useTerminal({
  serverId,
  terminalName,
  onData,
}: UseTerminalProps): UseTerminalReturn {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const connect = useCallback(async () => {
    if (!terminalName) return;
    try {
      setStatus('connecting');
      setError(null);
      await jupyterConnectTerminal(terminalName, serverId);
      setStatus('connected');
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to connect terminal');
      setStatus('error');
    }
  }, [terminalName, serverId]);

  const disconnect = useCallback(async () => {
    if (!terminalName) return;
    try {
      await jupyterDisconnectTerminal(terminalName, serverId);
      setStatus('disconnected');
    } catch (err) {
      console.error('Error disconnecting terminal:', err);
    }
  }, [terminalName, serverId]);

  const sendInput = useCallback(
    async (data: string) => {
      if (status !== 'connected' || !terminalName) return;
      try {
        await jupyterSendTerminalInput(terminalName, data, serverId);
      } catch (err) {
        console.error('Error sending input to terminal:', err);
      }
    },
    [status, terminalName, serverId]
  );

  const resize = useCallback(
    async (rows: number, cols: number) => {
      if (status !== 'connected' || !terminalName) return;
      try {
        await jupyterResizeTerminal(terminalName, rows, cols, serverId);
      } catch (err) {
        console.error('Error resizing terminal:', err);
      }
    },
    [status, terminalName, serverId]
  );

  useEffect(() => {
    let unlistenOutput: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    async function setupListeners() {
      unlistenOutput = await listen<{ server_id?: string; terminal_name: string; data: string }>(
        'jupyter:terminal_output',
        (event) => {
          if (event.payload.terminal_name === terminalName) {
            onDataRef.current?.(event.payload.data);
          }
        }
      );

      unlistenStatus = await listen<{ server_id?: string; terminal_name: string; status: string }>(
        'jupyter:terminal_status',
        (event) => {
          if (event.payload.terminal_name === terminalName) {
            if (event.payload.status === 'connected') setStatus('connected');
            if (event.payload.status === 'disconnected') setStatus('disconnected');
          }
        }
      );
    }

    setupListeners();

    return () => {
      unlistenOutput?.();
      unlistenStatus?.();
      if (status === 'connected') {
        jupyterDisconnectTerminal(terminalName, serverId).catch(() => {});
      }
    };
  }, [terminalName, serverId]);

  return {
    status,
    error,
    connect,
    disconnect,
    sendInput,
    resize,
  };
}
