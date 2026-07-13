import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  Activity, Bot, ChevronDown, Database, FileText, GripVertical, History,
  Maximize2, MessageSquarePlus, Minimize2, MoreHorizontal, Pencil, Plus, Send,
  Square, Wrench, X, Zap,
} from 'lucide-react';
import { useAgent } from '../../hooks/useAgent';
import type { AgentChatContext, AgentSessionListItem, AiConfig, Skill } from '../../types/agent';
import {
  agentCreateSession, agentGetConfig, agentGetMcpConfig, agentListSessions, agentRenameSession,
} from '../../services/tauriIpc';
import { ToolConfirmModal } from './ToolConfirmModal';
import { SkillSelector } from './SkillSelector';
import { KnowledgeModal } from './KnowledgeModal';
import { TraceViewerModal } from './TraceViewerModal';
import { MarkdownMessage, ToolExecutionCard } from './AgentMessageContent';

interface AgentChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  getWorkspaceContext?: () => AgentChatContext;
  width: number;
  onWidthChange: (width: number) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

type ContextChip = { id: string; label: string; value: string; keys: Array<keyof AgentChatContext> };

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  isOpen, onClose, getWorkspaceContext, width, onWidthChange, isFullscreen, onToggleFullscreen,
}) => {
  const [sessionId, setSessionId] = useState('default');
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [inputPrompt, setInputPrompt] = useState('');
  const [injectContext, setInjectContext] = useState(true);
  const [excludedContext, setExcludedContext] = useState<string[]>([]);
  const [workspaceContext, setWorkspaceContext] = useState<AgentChatContext>({});
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [mcpCount, setMcpCount] = useState(0);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [isSkillOpen, setIsSkillOpen] = useState(false);
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages, status, currentStreamingAnswer, activeToolCall, error, sendPrompt,
    confirmTool, cancelTask, clearHistory, dismissError,
  } = useAgent(sessionId);

  const refreshSessions = async () => {
    try {
      const loaded = await agentListSessions();
      setSessions(loaded);
      if (sessionId === 'default' && loaded.length > 0 && !loaded.some((session) => session.session_id === sessionId)) {
        setSessionId(loaded[0].session_id);
      }
    } catch (cause) {
      setPanelError(`Unable to load conversations: ${readableError(cause)}`);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (!isTauri()) {
      setPanelError(null);
      return;
    }
    void refreshSessions();
    void agentGetConfig().then(setAiConfig).catch(() => setAiConfig(null));
    void agentGetMcpConfig().then((config) => setMcpCount(config.servers.filter((server) => server.enabled).length)).catch(() => setMcpCount(0));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && status !== 'running' && isTauri()) void refreshSessions();
  }, [isOpen, status, messages.length]);

  useEffect(() => {
    if (!isOpen || !getWorkspaceContext) return;
    const update = () => setWorkspaceContext(getWorkspaceContext());
    update();
    const timer = window.setInterval(update, 2000);
    return () => window.clearInterval(timer);
  }, [getWorkspaceContext, isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamingAnswer]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [inputPrompt]);

  const currentSession = sessions.find((session) => session.session_id === sessionId);
  const contextChips = useMemo(() => buildContextChips(workspaceContext), [workspaceContext]);
  const visibleContextChips = contextChips.filter((chip) => !excludedContext.includes(chip.id));
  const providerName = aiConfig?.provider === 'ollama'
    ? `Ollama · ${aiConfig.ollama.chat_model}`
    : aiConfig ? `Remote · ${aiConfig.remote.chat_model}` : 'Provider unavailable';
  const runLabel = status === 'running'
    ? activeToolCall?.status === 'requires_confirmation' ? 'Waiting for approval' : activeToolCall?.status === 'running' ? 'Running tool' : 'Thinking'
    : status === 'error' ? 'Needs attention' : workspaceContext.kernel_id ? 'Ready with kernel' : 'Ready · No kernel';

  if (!isOpen) return null;

  const createSession = async () => {
    try {
      const id = `session-${crypto.randomUUID()}`;
      await agentCreateSession(id, 'New Chat', getWorkspaceContext?.());
      await refreshSessions();
      setSessionId(id);
      setSessionMenuOpen(false);
      setPanelError(null);
    } catch (cause) {
      setPanelError(`Unable to create conversation: ${readableError(cause)}`);
    }
  };

  const renameSession = async () => {
    if (!renameTitle?.trim()) return;
    try {
      await agentRenameSession(sessionId, renameTitle.trim());
      setRenameTitle(null);
      await refreshSessions();
    } catch (cause) {
      setPanelError(`Unable to rename conversation: ${readableError(cause)}`);
    }
  };

  const deleteSession = async () => {
    try {
      await clearHistory();
      const remaining = sessions.filter((session) => session.session_id !== sessionId);
      if (remaining.length > 0) setSessionId(remaining[0].session_id);
      else await createSession();
      setDeleteConfirmOpen(false);
      await refreshSessions();
    } catch (cause) {
      setPanelError(`Unable to delete conversation: ${readableError(cause)}`);
    }
  };

  const buildSelectedContext = (): AgentChatContext | undefined => {
    if (!injectContext) return undefined;
    const selected = { ...(getWorkspaceContext?.() ?? workspaceContext) };
    for (const chip of contextChips.filter((item) => excludedContext.includes(item.id))) {
      for (const key of chip.keys) delete selected[key];
    }
    return selected;
  };

  const handleSend = () => {
    if (!inputPrompt.trim() || status === 'running') return;
    void sendPrompt(inputPrompt, buildSelectedContext());
    setInputPrompt('');
  };

  const startResize = (event: React.MouseEvent) => {
    if (isFullscreen) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: MouseEvent) => onWidthChange(Math.min(760, Math.max(400, startWidth + startX - moveEvent.clientX)));
    const stop = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  };

  return (
    <>
      <section className="agent-workspace" aria-label="LabNexus AI Agent">
        {!isFullscreen && <div className="agent-workspace__resizer" onMouseDown={startResize} role="separator" aria-label="Resize AI Agent panel"><GripVertical size={16} /></div>}
        <header className="agent-workspace__header">
          <div className="agent-workspace__identity">
            <div className="agent-workspace__logo"><Bot size={19} /></div>
            <div className="min-w-0">
              <h2>LabNexus Assistant</h2>
              <div className="agent-workspace__status"><span className={`agent-status-dot ${status}`} />{runLabel}</div>
            </div>
          </div>
          <div className="agent-workspace__header-actions">
            <button type="button" onClick={() => setIsTraceOpen(true)} aria-label="Open execution traces" title="Execution traces"><Activity size={16} /></button>
            <button type="button" onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit full screen Agent' : 'Open full screen Agent'} title={isFullscreen ? 'Exit full screen' : 'Full screen'}>
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" onClick={onClose} aria-label="Close AI Agent" title="Close"><X size={17} /></button>
          </div>
        </header>

        <div className="agent-runtime-bar">
          <span title={providerName}><Zap size={12} />{providerName}</span>
          <span><Wrench size={12} />{mcpCount} MCP</span>
          <span><Database size={12} />{workspaceContext.kernel_status || (workspaceContext.kernel_id ? 'kernel' : 'offline')}</span>
        </div>

        <div className="agent-session-bar">
          <div className="agent-session-picker">
            <button type="button" className="agent-session-picker__trigger" onClick={() => setSessionMenuOpen((value) => !value)} aria-expanded={sessionMenuOpen}>
              <div><span>{currentSession?.title || 'New Chat'}</span><small>{currentSession?.message_count || messages.length} messages</small></div>
              <ChevronDown size={15} />
            </button>
            {sessionMenuOpen && (
              <div className="agent-session-menu">
                <div className="agent-session-menu__heading"><span>Conversations</span><button type="button" onClick={createSession} aria-label="New conversation"><Plus size={15} /></button></div>
                <div className="agent-session-menu__list">
                  {sessions.map((session) => (
                    <button type="button" key={session.session_id} className={session.session_id === sessionId ? 'active' : ''} onClick={() => { setSessionId(session.session_id); setSessionMenuOpen(false); }}>
                      <span>{session.title}</span><small>{formatRelativeTime(session.updated_at)} · {session.message_count}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button type="button" onClick={createSession} aria-label="New conversation" title="New conversation"><MessageSquarePlus size={16} /></button>
          <button type="button" onClick={() => setRenameTitle(currentSession?.title || 'New Chat')} aria-label="Rename conversation" title="Rename"><Pencil size={15} /></button>
          <button type="button" onClick={() => setDeleteConfirmOpen(true)} aria-label="Conversation actions" title="Delete conversation"><MoreHorizontal size={16} /></button>
        </div>

        <main className="agent-conversation" aria-live="polite">
          {messages.length === 0 && !currentStreamingAnswer && (
            <div className="agent-empty-state">
              <div><Zap size={25} /></div><h3>What would you like to work on?</h3>
              <p>Analyze a notebook, inspect an error, transform data, or ask the Agent to run a scientific workflow.</p>
              <div className="agent-empty-state__actions">
                <button type="button" onClick={() => setInputPrompt('Summarize the current notebook and identify the next useful analysis step.')}>Summarize notebook</button>
                <button type="button" onClick={() => setInputPrompt('Inspect the current error and propose a safe fix.')}>Diagnose error</button>
              </div>
            </div>
          )}

          {messages.map((message) => {
            if (message.role === 'tool') return null;
            if (message.role === 'user') return <div key={message.id} className="agent-message agent-message--user"><div>{message.content}</div></div>;
            return (
              <article key={message.id} className="agent-message agent-message--assistant">
                <div className="agent-message__avatar"><Bot size={14} /></div>
                <div className="agent-message__body">
                  {message.content && <MarkdownMessage content={message.content} onUseCode={(code) => setInputPrompt((current) => `${current}${current ? '\n\n' : ''}${code}`)} />}
                  {message.tool_calls && message.tool_calls.length > 0 && (
                    <div className="agent-tool-timeline">
                      <div className="agent-tool-timeline__label"><History size={13} />Execution</div>
                      {message.tool_calls.map((call) => <ToolExecutionCard key={call.id} call={call} result={messages.find((candidate) => candidate.role === 'tool' && candidate.tool_call_id === call.id)} />)}
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          {currentStreamingAnswer && (
            <article className="agent-message agent-message--assistant"><div className="agent-message__avatar"><Bot size={14} /></div><div className="agent-message__body"><MarkdownMessage content={currentStreamingAnswer} /><span className="agent-stream-cursor" /></div></article>
          )}

          {activeToolCall?.status === 'running' && (
            <div className="agent-running-card"><span className="agent-spinner" /><div><strong>Running tool</strong><code>{activeToolCall.tool_name}</code></div></div>
          )}

          {(error || panelError) && (
            <div className="agent-error-card" role="alert"><div><strong>Agent needs attention</strong><p>{error || panelError}</p></div><button type="button" onClick={() => { dismissError(); setPanelError(null); }} aria-label="Dismiss error"><X size={15} /></button></div>
          )}
          <div ref={messagesEndRef} />
        </main>

        <footer className="agent-composer">
          <div className="agent-composer__topbar">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setIsSkillOpen(true)}><Zap size={13} />Skills</button>
              <button type="button" onClick={() => setIsKnowledgeOpen(true)}><Database size={13} />Knowledge</button>
            </div>
            <label><input type="checkbox" checked={injectContext} onChange={(event) => setInjectContext(event.target.checked)} />Notebook context</label>
          </div>
          {injectContext && visibleContextChips.length > 0 && (
            <div className="agent-context-chips">
              {visibleContextChips.map((chip) => <span key={chip.id} title={chip.value}><FileText size={11} />{chip.label}<button type="button" onClick={() => setExcludedContext((items) => [...items, chip.id])} aria-label={`Remove ${chip.label} context`}><X size={11} /></button></span>)}
              {excludedContext.length > 0 && <button type="button" className="agent-context-reset" onClick={() => setExcludedContext([])}>Restore</button>}
            </div>
          )}
          <div className="agent-composer__input">
            <textarea ref={inputRef} rows={1} value={inputPrompt} onChange={(event) => setInputPrompt(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); handleSend(); }
            }} placeholder="Ask the Agent to analyze, explain, or act…" disabled={status === 'running'} aria-label="Agent prompt" />
            <div className="agent-composer__actions">
              <span>Enter to send · Shift+Enter for newline</span>
              {status === 'running' ? (
                <div><button type="button" className="stop" onClick={() => cancelTask(false)} title="Stop Agent"><Square size={14} />Stop</button><button type="button" className="interrupt" onClick={() => cancelTask(true)} title="Stop Agent and interrupt kernel"><Zap size={14} /></button></div>
              ) : <button type="button" className="send" onClick={handleSend} disabled={!inputPrompt.trim()} aria-label="Send prompt"><Send size={15} /></button>}
            </div>
          </div>
        </footer>
      </section>

      <ToolConfirmModal toolCall={activeToolCall} onConfirm={confirmTool} />
      {isSkillOpen && <SkillSelector onClose={() => setIsSkillOpen(false)} onSelectSkill={(skill: Skill) => setInputPrompt((current) => `/${skill.id} ${current}`.trim() + ' ')} />}
      {isKnowledgeOpen && <KnowledgeModal onClose={() => setIsKnowledgeOpen(false)} />}
      {isTraceOpen && <TraceViewerModal onClose={() => setIsTraceOpen(false)} />}

      {renameTitle !== null && <AgentDialog title="Rename conversation" onClose={() => setRenameTitle(null)} actions={<><button type="button" onClick={() => setRenameTitle(null)}>Cancel</button><button type="button" className="primary" onClick={renameSession}>Save</button></>}><input autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void renameSession()} /></AgentDialog>}
      {deleteConfirmOpen && <AgentDialog title="Delete this conversation?" onClose={() => setDeleteConfirmOpen(false)} actions={<><button type="button" onClick={() => setDeleteConfirmOpen(false)}>Cancel</button><button type="button" className="danger" onClick={deleteSession}>Delete</button></>}><p>This removes the conversation and its history. This action cannot be undone.</p></AgentDialog>}
    </>
  );
};

const AgentDialog: React.FC<{ title: string; onClose: () => void; actions: React.ReactNode; children: React.ReactNode }> = ({ title, onClose, actions, children }) => (
  <div className="agent-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="agent-dialog" role="dialog" aria-modal="true" aria-label={title}><div className="agent-dialog__header"><h3>{title}</h3><button type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div><div className="agent-dialog__content">{children}</div><div className="agent-dialog__actions">{actions}</div></div>
  </div>
);

function buildContextChips(context: AgentChatContext): ContextChip[] {
  const chips: ContextChip[] = [];
  if (context.notebook_path) chips.push({ id: 'notebook', label: context.notebook_path.split('/').pop() || context.notebook_path, value: context.notebook_path, keys: ['notebook_path', 'server_id', 'session_id'] });
  if (context.kernel_id) chips.push({ id: 'kernel', label: context.kernel_status || 'Kernel', value: context.kernel_id, keys: ['kernel_id', 'kernel_status'] });
  if (context.active_cell_code) chips.push({ id: 'cell', label: `Cell ${typeof context.active_cell_index === 'number' ? context.active_cell_index + 1 : ''}`.trim(), value: context.active_cell_code, keys: ['active_cell_id', 'active_cell_index', 'active_cell_code'] });
  if (context.last_error) chips.push({ id: 'error', label: 'Last error', value: context.last_error, keys: ['last_error'] });
  return chips;
}

function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, '').replace(/^Agent error:\s*/i, '');
}
