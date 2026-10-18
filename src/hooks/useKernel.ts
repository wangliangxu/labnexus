import { t, localizeStatus } from '../i18n';
/**
 * useKernel — Hook for managing remote Jupyter kernel WebSocket and cell executions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import type {
  KernelInfo,
  SessionInfo,
  KernelStatus,
  CellOutput,
} from '../types/jupyter';
import {
  jupyterCreateSession,
  jupyterConnectKernelWs,
  jupyterSendKernelMsg,
  jupyterDisconnectKernelWs,
  jupyterInterruptKernel,
  jupyterRestartKernel,
} from '../services/tauriIpc';

interface UseKernelProps {
  serverId?: string;
  notebookPath: string;
  kernelName?: string;
  onCellOutput?: (cellId: string, output: CellOutput) => void;
  onCellExecutionDone?: (cellId: string, executionCount?: number, hadError?: boolean) => void;
}

interface UseKernelReturn {
  session: SessionInfo | null;
  kernel: KernelInfo | null;
  status: KernelStatus;
  isConnecting: boolean;
  isReady: boolean;
  error: string | null;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  executeCell: (cellId: string, code: string) => Promise<boolean>;
  interrupt: () => Promise<void>;
  restart: () => Promise<void>;
}

interface KernelMsgPayload {
  kernel_id: string;
  msg?: {
    header: { msg_id: string; msg_type: string; username?: string; session?: string };
    parent_header?: { msg_id?: string; username?: string; session?: string };
    content: Record<string, any>;
  };
  raw?: string;
}

export function useKernel({
  serverId,
  notebookPath,
  kernelName = 'python3',
  onCellOutput,
  onCellExecutionDone,
}: UseKernelProps): UseKernelReturn {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<KernelStatus>('unknown');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Map request msg_id -> cellId
  const msgIdToCellIdRef = useRef<Map<string, string>>(new Map());
  const erroredCellsRef = useRef<Set<string>>(new Set());
  const latestCellIdRef = useRef<string | null>(null);

  // Store callbacks in refs to avoid re-triggering useEffects
  const onOutputRef = useRef(onCellOutput);
  onOutputRef.current = onCellOutput;
  const onDoneRef = useRef(onCellExecutionDone);
  onDoneRef.current = onCellExecutionDone;

  const kernelId = session?.kernel.id;

  const clearPendingExecutions = useCallback(() => {
    const pendingCellIds = new Set(msgIdToCellIdRef.current.values());
    msgIdToCellIdRef.current.clear();
    erroredCellsRef.current.clear();
    if (latestCellIdRef.current) {
      pendingCellIds.add(latestCellIdRef.current);
      latestCellIdRef.current = null;
    }
    pendingCellIds.forEach((cellId) => {
      onDoneRef.current?.(cellId, undefined, true);
    });
  }, []);

  // Listen for kernel WebSocket events from Rust backend
  useEffect(() => {
    console.log('[useKernel] Setting up listeners for kernelId:', kernelId);

    const unlistenStatus = listen<{ kernel_id: string; status: string; message?: string }>(
      'kernel:status',
      (event) => {
        console.log('[useKernel] kernel:status event:', event.payload);
        if (event.payload.kernel_id === kernelId) {
          if (event.payload.status === 'connected') {
            setIsWsConnected(true);
            setStatus('idle');
            setError(null);
            return;
          }
          setStatus(event.payload.status as KernelStatus);
          if (event.payload.status === 'error' && event.payload.message) {
            setError(event.payload.message);
          }
          if (
            event.payload.status === 'error' ||
            event.payload.status === 'disconnected' ||
            event.payload.status === 'dead'
          ) {
            setIsWsConnected(false);
            clearPendingExecutions();
          }
        }
      }
    );

    const unlistenMsg = listen<KernelMsgPayload>('kernel:msg', (event) => {
      const { kernel_id, msg } = event.payload;
      if (kernel_id !== kernelId || !msg) return;

      const msgType = msg.header?.msg_type;
      const parentId = msg.parent_header?.msg_id;
      const parentUsername = msg.parent_header?.username;
      const parentSession = msg.parent_header?.session;
      const content = msg.content;

      if (!msgType || !content) return;

      // Update kernel execution state
      if (msgType === 'status' && content.execution_state) {
        setStatus(content.execution_state as KernelStatus);
      }

      // Ignore outputs triggered by the AI Agent's background tool calls
      if (
        parentUsername === 'labnexus_agent' ||
        parentSession === 'agent_session'
      ) {
        return;
      }

      const outputMsgTypes = new Set([
        'stream',
        'display_data',
        'execute_result',
        'error',
        'execute_reply',
        'status',
      ]);
      const mappedCellId = parentId
        ? msgIdToCellIdRef.current.get(parentId)
        : undefined;
      const fallbackCellId =
        !parentId && outputMsgTypes.has(msgType)
          ? latestCellIdRef.current
          : null;
      const cellId = mappedCellId || fallbackCellId;

      // If this message belongs to a cell execution request
      if (cellId) {
        if (msgType === 'stream') {
          onOutputRef.current?.(cellId, {
            output_type: 'stream',
            name: content.name,
            text: content.text,
          });
        } else if (msgType === 'display_data') {
          onOutputRef.current?.(cellId, {
            output_type: 'display_data',
            data: content.data || {},
            metadata: content.metadata || {},
          });
        } else if (msgType === 'execute_result') {
          onOutputRef.current?.(cellId, {
            output_type: 'execute_result',
            execution_count: content.execution_count || 0,
            data: content.data || {},
            metadata: content.metadata || {},
          });
          onDoneRef.current?.(
            cellId,
            content.execution_count,
            erroredCellsRef.current.has(cellId)
          );
        } else if (msgType === 'error') {
          erroredCellsRef.current.add(cellId);
          onOutputRef.current?.(cellId, {
            output_type: 'error',
            ename: content.ename || 'Error',
            evalue: content.evalue || '',
            traceback: content.traceback || [],
          });
          if (parentId) msgIdToCellIdRef.current.delete(parentId);
          if (latestCellIdRef.current === cellId) latestCellIdRef.current = null;
          onDoneRef.current?.(cellId, undefined, true);
        } else if (msgType === 'execute_reply') {
          const isReplyError = content.status === 'error' || content.status === 'aborted';
          if (isReplyError) erroredCellsRef.current.add(cellId);
          onDoneRef.current?.(
            cellId,
            typeof content.execution_count === 'number' ? content.execution_count : undefined,
            erroredCellsRef.current.has(cellId)
          );
        } else if (
          msgType === 'status' &&
          content.execution_state === 'idle'
        ) {
          // Cell finished execution
          const hadError = erroredCellsRef.current.has(cellId);
          erroredCellsRef.current.delete(cellId);
          if (parentId) msgIdToCellIdRef.current.delete(parentId);
          if (latestCellIdRef.current === cellId) latestCellIdRef.current = null;
          onDoneRef.current?.(cellId, undefined, hadError);
        }
      }
    });

    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenMsg.then((fn) => fn());
    };
  }, [kernelId, clearPendingExecutions]);

  const startSession = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setStatus('starting');
    setIsWsConnected(false);
    setSession(null);
    clearPendingExecutions();
    console.log('[useKernel] Starting session for', notebookPath, 'kernel:', kernelName, 'server:', serverId);
    let createdSession: SessionInfo | null = null;
    try {
      // 1. Create or attach session via REST API
      createdSession = await jupyterCreateSession(
        notebookPath,
        kernelName,
        serverId
      );
      console.log('[useKernel] Session created:', createdSession.id, 'kernel:', createdSession.kernel.id);
      setSession(createdSession);

      // 2. Connect WebSocket via Rust backend (handles SOCKS5 / SSH -D tunnel automatically!)
      console.log('[useKernel] Connecting kernel WebSocket for:', createdSession.kernel.id);
      await jupyterConnectKernelWs(createdSession.kernel.id, serverId);
      console.log('[useKernel] WebSocket connected for kernel:', createdSession.kernel.id);
      setIsWsConnected(true);
      setStatus('idle');
    } catch (e: unknown) {
      console.error('[useKernel] startSession error:', e);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setIsWsConnected(false);
      setStatus(createdSession ? 'disconnected' : 'dead');
    } finally {
      setIsConnecting(false);
    }
  }, [notebookPath, kernelName, serverId, clearPendingExecutions]);

  const stopSession = useCallback(async () => {
    if (!kernelId) return;
    try {
      await jupyterDisconnectKernelWs(kernelId);
      setIsWsConnected(false);
      setSession(null);
      setStatus('disconnected');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [kernelId]);

  const executeCell = useCallback(
    async (cellId: string, code: string) => {
      if (!kernelId || !isWsConnected) {
        const msg = kernelId
          ? t('Kernel WebSocket is not connected')
          : t('No kernel');
        console.error('[useKernel] Cannot execute:', msg);
        setError(msg);
        onDoneRef.current?.(cellId);
        return false;
      }
      if (
        isConnecting ||
        status === 'starting' ||
        status === 'restarting' ||
        status === 'dead' ||
        status === 'disconnected' ||
        status === 'unknown' ||
        status === 'error'
      ) {
        const msg = t('Kernel is not ready (status: {status})', { status: localizeStatus(status) });
        console.error('[useKernel] Cannot execute:', msg);
        setError(msg);
        onDoneRef.current?.(cellId);
        return false;
      }
      console.log('[useKernel] Executing cell:', cellId, 'on kernel:', kernelId);
      let msgId: string | null = null;
      try {
        msgId = crypto.randomUUID();
        msgIdToCellIdRef.current.set(msgId, cellId);
        latestCellIdRef.current = cellId;
        console.log('[useKernel] Mapped msgId', msgId, '-> cellId', cellId);

        const req = {
          header: {
            msg_id: msgId,
            msg_type: 'execute_request',
            username: 'labnexus',
            session: session?.id || 'default',
            date: new Date().toISOString(),
            version: '5.3',
          },
          parent_header: {},
          metadata: {},
          content: {
            code,
            silent: false,
            store_history: true,
            user_expressions: {},
            allow_stdin: false,
            stop_on_error: true,
          },
          channel: 'shell',
        };

        setStatus('busy');
        await jupyterSendKernelMsg(kernelId, req);
        console.log('[useKernel] Execute request sent successfully');
        return true;
      } catch (e: unknown) {
        console.error('[useKernel] executeCell error:', e);
        const msg = e instanceof Error ? e.message : String(e);
        if (msgId) {
          msgIdToCellIdRef.current.delete(msgId);
        }
        if (latestCellIdRef.current === cellId) {
          latestCellIdRef.current = null;
        }
        setError(msg);
        setStatus('idle');
        onDoneRef.current?.(cellId);
        return false;
      }
    },
    [kernelId, session?.id, status, isConnecting, isWsConnected]
  );

  const interrupt = useCallback(async () => {
    if (!kernelId) return;
    try {
      await jupyterInterruptKernel(kernelId, serverId);
      setStatus('idle');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [kernelId, serverId]);

  const restart = useCallback(async () => {
    if (!kernelId) {
      setError(t('No kernel'));
      return;
    }
    try {
      setStatus('restarting');
      setIsConnecting(true);
      setIsWsConnected(false);
      setError(null);
      clearPendingExecutions();
      await jupyterRestartKernel(kernelId, serverId);
      // Re-connect WebSocket after restart
      await jupyterConnectKernelWs(kernelId, serverId);
      setIsWsConnected(true);
      setStatus('idle');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setIsWsConnected(false);
      setStatus('disconnected');
    } finally {
      setIsConnecting(false);
    }
  }, [kernelId, serverId, clearPendingExecutions]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (kernelId) {
        jupyterDisconnectKernelWs(kernelId).catch(() => {});
      }
    };
  }, [kernelId]);

  return {
    session,
    kernel: session?.kernel ?? null,
    status,
    isConnecting,
    // A busy Jupyter kernel can still accept execute_request messages: they are
    // queued by the kernel and run in order. Only connection/lifecycle states
    // should disable execution controls.
    isReady:
      Boolean(kernelId) &&
      isWsConnected &&
      !isConnecting &&
      status !== 'starting' &&
      status !== 'restarting' &&
      status !== 'dead' &&
      status !== 'disconnected' &&
      status !== 'unknown' &&
      status !== 'error',
    error,
    startSession,
    stopSession,
    executeCell,
    interrupt,
    restart,
  };
}
