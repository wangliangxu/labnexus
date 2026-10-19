/**
 * useAgent — Hook for managing ReAct agent chat sessions, streaming tokens, and tool calls.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import type {
  AgentMessage,
  AgentStreamEvent,
  AgentToolCallEvent,
  AgentChatContext,
} from '../types/agent';
import {
  agentRunTask,
  agentGetHistory,
  agentClearSession,
  agentConfirmTool,
  agentCancelTask,
} from '../services/tauriIpc';

export type AgentStatus = 'idle' | 'running' | 'error';

export interface UseAgentReturn {
  messages: AgentMessage[];
  status: AgentStatus;
  currentStreamingThought: string;
  currentStreamingAnswer: string;
  activeToolCall: AgentToolCallEvent | null;
  error: string | null;
  sendPrompt: (prompt: string, context?: AgentChatContext) => Promise<void>;
  confirmTool: (approved: boolean, scope?: 'once' | 'session') => Promise<void>;
  cancelTask: (interruptKernel?: boolean) => Promise<void>;
  clearHistory: () => Promise<void>;
  dismissError: () => void;
}

export function useAgent(sessionId: string = 'default'): UseAgentReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [currentStreamingThought, setCurrentStreamingThought] = useState<string>('');
  const [currentStreamingAnswer, setCurrentStreamingAnswer] = useState<string>('');
  const [activeToolCall, setActiveToolCall] = useState<AgentToolCallEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef(sessionId);
  const activeRunIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  // Load initial history
  const refreshHistory = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const history = await agentGetHistory(sessionIdRef.current);
      // Filter out system messages from UI
      setMessages(history.filter((m) => m.role !== 'system'));
    } catch (e: unknown) {
      console.error('Failed to load agent history:', e);
    }
  }, []);

  useEffect(() => {
    setMessages([]);
    setCurrentStreamingThought('');
    setCurrentStreamingAnswer('');
    setActiveToolCall(null);
    setError(null);
    setStatus('idle');
    activeRunIdRef.current = null;
    refreshHistory();
  }, [sessionId, refreshHistory]);

  // Listen for real-time stream and tool events
  useEffect(() => {
    if (!isTauri()) return;
    const unlistenStream = listen<AgentStreamEvent>('agent:stream', (event) => {
      const { session_id, chunk_type, content } = event.payload;
      if (session_id !== sessionIdRef.current) return;
      if (activeRunIdRef.current && event.payload.run_id !== activeRunIdRef.current) return;

      if (chunk_type === 'thought') {
        setCurrentStreamingThought((prev) => prev + content);
      } else if (chunk_type === 'answer') {
        setCurrentStreamingAnswer((prev) => prev + content);
      } else if (chunk_type === 'done') {
        setCurrentStreamingThought('');
        setCurrentStreamingAnswer('');
        setActiveToolCall(null);
        setStatus('idle');
        activeRunIdRef.current = null;
        refreshHistory();
      } else if (chunk_type === 'error') {
        setError(content);
        setCurrentStreamingThought('');
        setCurrentStreamingAnswer('');
        setActiveToolCall(null);
        setStatus('error');
        activeRunIdRef.current = null;
        refreshHistory();
      }
    });

    const unlistenTool = listen<AgentToolCallEvent>('agent:tool_call', (event) => {
      const payload = event.payload;
      if (payload.session_id !== sessionIdRef.current) return;
      if (activeRunIdRef.current && payload.run_id !== activeRunIdRef.current) return;

      if (payload.status === 'requires_confirmation') {
        setCurrentStreamingThought('');
        setCurrentStreamingAnswer('');
        setActiveToolCall(payload);
        refreshHistory();
      } else if (payload.status === 'running') {
        setCurrentStreamingThought('');
        setCurrentStreamingAnswer('');
        setActiveToolCall(payload);
        refreshHistory();
      } else if (payload.status === 'completed' || payload.status === 'error') {
        // Keep brief visual feedback or clear
        setActiveToolCall(payload);
        setTimeout(() => {
          setActiveToolCall((curr) =>
            curr?.tool_call_id === payload.tool_call_id ? null : curr
          );
          refreshHistory();
        }, 1200);
      }
    });

    return () => {
      unlistenStream.then((fn) => fn());
      unlistenTool.then((fn) => fn());
    };
  }, [refreshHistory]);

  const sendPrompt = useCallback(
    async (prompt: string, context?: AgentChatContext) => {
      if (!prompt.trim() || status === 'running') return;

      setError(null);
      setCurrentStreamingThought('');
      setCurrentStreamingAnswer('');
      setActiveToolCall(null);
      setStatus('running');
      const runId = crypto.randomUUID();
      activeRunIdRef.current = runId;

      // Optimistically append user message to UI
      const tempUserMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);

      try {
        await agentRunTask(sessionIdRef.current, runId, prompt, context);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus('error');
        activeRunIdRef.current = null;
        refreshHistory();
      }
    },
    [status, refreshHistory]
  );

  const confirmTool = useCallback(
    async (approved: boolean, scope: 'once' | 'session' = 'once') => {
      if (!activeToolCall || activeToolCall.status !== 'requires_confirmation') return;
      try {
        await agentConfirmTool(
          sessionIdRef.current,
          activeToolCall.run_id,
          activeToolCall.tool_call_id,
          approved,
          scope
        );
        if (!approved) {
          setActiveToolCall(null);
        } else {
          setActiveToolCall((prev) =>
            prev ? { ...prev, status: 'running' } : null
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    },
    [activeToolCall]
  );

  const cancelTask = useCallback(async (interruptKernel: boolean = false) => {
    const runId = activeRunIdRef.current;
    if (!runId) return;
    try {
      await agentCancelTask(sessionIdRef.current, runId, interruptKernel);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    try {
      await agentClearSession(sessionIdRef.current);
      setMessages([]);
      setError(null);
      setCurrentStreamingThought('');
      setCurrentStreamingAnswer('');
      setActiveToolCall(null);
      setStatus('idle');
      activeRunIdRef.current = null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  return {
    messages,
    status,
    currentStreamingThought,
    currentStreamingAnswer,
    activeToolCall,
    error,
    sendPrompt,
    confirmTool,
    cancelTask,
    clearHistory,
    dismissError: () => setError(null),
  };
}
