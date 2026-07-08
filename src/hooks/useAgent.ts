/**
 * useAgent — Hook for managing ReAct agent chat sessions, streaming tokens, and tool calls.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
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
} from '../services/tauriIpc';

export type AgentStatus = 'idle' | 'running' | 'error';

export interface UseAgentReturn {
  messages: AgentMessage[];
  status: AgentStatus;
  currentStreamingAnswer: string;
  activeToolCall: AgentToolCallEvent | null;
  error: string | null;
  sendPrompt: (prompt: string, context?: AgentChatContext) => Promise<void>;
  confirmTool: (approved: boolean) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export function useAgent(sessionId: string = 'default'): UseAgentReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [currentStreamingAnswer, setCurrentStreamingAnswer] = useState<string>('');
  const [activeToolCall, setActiveToolCall] = useState<AgentToolCallEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Load initial history
  const refreshHistory = useCallback(async () => {
    try {
      const history = await agentGetHistory(sessionIdRef.current);
      // Filter out system messages from UI
      setMessages(history.filter((m) => m.role !== 'system'));
    } catch (e: unknown) {
      console.error('Failed to load agent history:', e);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [sessionId, refreshHistory]);

  // Listen for real-time stream and tool events
  useEffect(() => {
    const unlistenStream = listen<AgentStreamEvent>('agent:stream', (event) => {
      const { session_id, chunk_type, content } = event.payload;
      if (session_id !== sessionIdRef.current) return;

      if (chunk_type === 'answer') {
        setCurrentStreamingAnswer((prev) => prev + content);
      } else if (chunk_type === 'done') {
        setCurrentStreamingAnswer('');
        setActiveToolCall(null);
        setStatus('idle');
        refreshHistory();
      } else if (chunk_type === 'error') {
        setError(content);
        setCurrentStreamingAnswer('');
        setActiveToolCall(null);
        setStatus('error');
        refreshHistory();
      }
    });

    const unlistenTool = listen<AgentToolCallEvent>('agent:tool_call', (event) => {
      const payload = event.payload;
      if (payload.session_id !== sessionIdRef.current) return;

      if (payload.status === 'requires_confirmation') {
        setActiveToolCall(payload);
      } else if (payload.status === 'running') {
        setActiveToolCall(payload);
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
      setCurrentStreamingAnswer('');
      setActiveToolCall(null);
      setStatus('running');

      // Optimistically append user message to UI
      const tempUserMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);

      try {
        await agentRunTask(sessionIdRef.current, prompt, context);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus('error');
        refreshHistory();
      }
    },
    [status, refreshHistory]
  );

  const confirmTool = useCallback(
    async (approved: boolean) => {
      if (!activeToolCall || activeToolCall.status !== 'requires_confirmation') return;
      try {
        await agentConfirmTool(
          sessionIdRef.current,
          activeToolCall.tool_call_id,
          approved
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

  const clearHistory = useCallback(async () => {
    try {
      await agentClearSession(sessionIdRef.current);
      setMessages([]);
      setError(null);
      setCurrentStreamingAnswer('');
      setActiveToolCall(null);
      setStatus('idle');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  return {
    messages,
    status,
    currentStreamingAnswer,
    activeToolCall,
    error,
    sendPrompt,
    confirmTool,
    clearHistory,
  };
}
