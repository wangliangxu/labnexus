import { t, useLocale, localizeStatus } from '../../i18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  Activity, Sparkles, ChevronDown, Database, FileText, GripVertical, History,
  Maximize2, MessageSquarePlus, Minimize2, MoreHorizontal, Pencil, Send,
  Square, Trash2, X, Zap,
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
  const locale = useLocale();
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
  const sessionPickerRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages, status, currentStreamingThought, currentStreamingAnswer, activeToolCall, error, sendPrompt,
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
      setPanelError(t('Unable to load conversations: {error}', { error: readableError(cause) }));
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
  }, [messages, currentStreamingThought, currentStreamingAnswer]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [inputPrompt]);

  useEffect(() => {
    if (!isOpen) return;
    const dismissMenus = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!sessionPickerRef.current?.contains(event.target)) setSessionMenuOpen(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) moreMenuRef.current.open = false;
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (moreMenuRef.current?.open) {
        moreMenuRef.current.open = false;
        moreMenuRef.current.querySelector('summary')?.focus();
      }
      if (sessionMenuOpen) {
        setSessionMenuOpen(false);
        sessionPickerRef.current?.querySelector('button')?.focus();
      }
    };
    window.addEventListener('pointerdown', dismissMenus);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('pointerdown', dismissMenus);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isOpen, sessionMenuOpen]);

  const openFromMenu = (action: () => void) => {
    if (moreMenuRef.current) moreMenuRef.current.open = false;
    action();
  };

  const currentSession = sessions.find((session) => session.session_id === sessionId);
  const contextChips = useMemo(() => buildContextChips(workspaceContext), [workspaceContext, locale]);
  const visibleContextChips = contextChips.filter((chip) => !excludedContext.includes(chip.id));
  const providerName = aiConfig?.provider === 'ollama'
    ? `Ollama · ${aiConfig.ollama.chat_model}`
    : aiConfig ? t('Remote · {model}', { model: aiConfig.remote.chat_model }) : t('Provider unavailable');
  const runLabel = status === 'running'
    ? activeToolCall?.status === 'requires_confirmation' ? t('Waiting for approval') : activeToolCall?.status === 'running' ? t('Running tool') : t('Thinking')
    : t('Needs attention');

  if (!isOpen) return null;

  const createSession = async () => {
    try {
      const id = `session-${crypto.randomUUID()}`;
      await agentCreateSession(id, t('New Chat'), getWorkspaceContext?.());
      await refreshSessions();
      setSessionId(id);
      setSessionMenuOpen(false);
      setPanelError(null);
    } catch (cause) {
      setPanelError(t('Unable to create conversation: {error}', { error: readableError(cause) }));
    }
  };

  const renameSession = async () => {
    if (!renameTitle?.trim()) return;
    try {
      await agentRenameSession(sessionId, renameTitle.trim());
      setRenameTitle(null);
      await refreshSessions();
    } catch (cause) {
      setPanelError(t('Unable to rename conversation: {error}', { error: readableError(cause) }));
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
      setPanelError(t('Unable to delete conversation: {error}', { error: readableError(cause) }));
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
      <section className="agent-workspace" aria-label={t('LabNexus AI Agent')}>
        {!isFullscreen && <div className="agent-workspace__resizer" onMouseDown={startResize} role="separator" aria-label={t('Resize AI Agent panel')}><GripVertical size={16} /></div>}
        <header className="agent-workspace__header">
          <div className="agent-workspace__identity">
            <Sparkles size={18} strokeWidth={1.5} aria-hidden="true" />
            <div className="agent-session-picker" ref={sessionPickerRef}>
              <button type="button" className="agent-session-picker__trigger" onClick={() => {
                setSessionMenuOpen((value) => !value);
                if (moreMenuRef.current) moreMenuRef.current.open = false;
              }} aria-label={t('Choose conversation')} aria-expanded={sessionMenuOpen} aria-controls="agent-conversations">
                <span>{currentSession?.title || t('Assistant')}</span><ChevronDown size={14} />
              </button>
              {sessionMenuOpen && (
                <div className="agent-session-menu" id="agent-conversations">
                  <div className="agent-session-menu__heading"><span>{t('Conversations')}</span></div>
                  <div className="agent-session-menu__list">
                    {sessions.length === 0 && <p className="agent-menu-empty">{t('No saved conversations yet.')}</p>}
                    {sessions.map((session) => (
                      <button type="button" key={session.session_id} className={session.session_id === sessionId ? 'active' : ''} onClick={() => { setSessionId(session.session_id); setSessionMenuOpen(false); }}>
                        <span>{session.title}</span><small>{formatRelativeTime(session.updated_at)} · {t('{count} messages', { count: session.message_count })}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="agent-workspace__header-actions">
            <button type="button" onClick={createSession} disabled={status === 'running'} aria-label={t('New conversation')} title={t('New conversation')}><MessageSquarePlus size={16} strokeWidth={1.5} /></button>
            <details className="agent-more-menu" ref={moreMenuRef} onToggle={(event) => { if (event.currentTarget.open) setSessionMenuOpen(false); }}>
              <summary aria-label={t('More assistant options')} title={t('More options')}><MoreHorizontal size={18} strokeWidth={1.5} /></summary>
              <div className="agent-more-menu__content">
                <button type="button" onClick={() => openFromMenu(() => setIsSkillOpen(true))}><Zap size={15} />{t('Skills')}</button>
                <button type="button" onClick={() => openFromMenu(() => setIsKnowledgeOpen(true))}><Database size={15} />{t('Knowledge')}</button>
                <button type="button" onClick={() => openFromMenu(() => setIsTraceOpen(true))}><Activity size={15} />{t('Execution traces')}</button>
                <hr />
                <button type="button" onClick={() => openFromMenu(onToggleFullscreen)}>{isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{isFullscreen ? t('Exit full screen') : t('Full screen')}</button>
                <button type="button" disabled={status === 'running'} onClick={() => openFromMenu(() => setRenameTitle(currentSession?.title || t('New Chat')))}><Pencil size={15} />{t('Rename conversation')}</button>
                <button type="button" className="danger" disabled={status === 'running'} onClick={() => openFromMenu(() => setDeleteConfirmOpen(true))}><Trash2 size={15} />{t('Delete conversation')}</button>
                <div className="agent-more-menu__runtime">
                  <span title={providerName}>{providerName}</span>
                  <span>{mcpCount} MCP · {localizeStatus(workspaceContext.kernel_status) || (workspaceContext.kernel_id ? t('Kernel connected') : t('No kernel'))}</span>
                </div>
              </div>
            </details>
            <button type="button" onClick={onClose} aria-label={t('Close AI Agent')} title={t('Close')}><X size={17} strokeWidth={1.5} /></button>
          </div>
        </header>
        {status !== 'idle' && <div className="agent-workspace__status" role="status"><span className={`agent-status-dot ${status}`} />{runLabel}</div>}

        <main className="agent-conversation" aria-live="polite">
          {messages.length === 0 && !currentStreamingThought && !currentStreamingAnswer && (
            <div className="agent-empty-state">
              <h3>{t('How can I help?')}</h3>
              <p>{t('Ask about your notebook or describe a task.')}</p>
              <div className="agent-empty-state__actions">
                <button type="button" onClick={() => setInputPrompt(t('Summarize the current notebook and identify the next useful analysis step.'))}>{t('Summarize notebook')}</button>
                <button type="button" onClick={() => setInputPrompt(t('Inspect the current error and propose a safe fix.'))}>{t('Diagnose error')}</button>
              </div>
            </div>
          )}

          {messages.map((message) => {
            if (message.role === 'tool') return null;
            if (message.role === 'user') return <div key={message.id} className="agent-message agent-message--user"><div>{message.content}</div></div>;
            return (
              <article key={message.id} className="agent-message agent-message--assistant">
                <div className="agent-message__avatar"><Sparkles size={14} strokeWidth={1.5} /></div>
                <div className="agent-message__body">
                  {message.reasoning_content && (
                    <details className="agent-tool-timeline">
                      <summary><Sparkles size={13} />{t('Reasoning')}</summary>
                      <div style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{message.reasoning_content}</div>
                    </details>
                  )}
                  {message.content && <MarkdownMessage content={message.content} onUseCode={(code) => setInputPrompt((current) => `${current}${current ? '\n\n' : ''}${code}`)} />}
                  {message.tool_calls && message.tool_calls.length > 0 && (
                    <details className="agent-tool-timeline">
                      <summary><History size={13} />{message.tool_calls.length} {t('tool')} {message.tool_calls.length === 1 ? 'call' : 'calls'}</summary>
                      {message.tool_calls.map((call) => <ToolExecutionCard key={call.id} call={call} result={messages.find((candidate) => candidate.role === 'tool' && candidate.tool_call_id === call.id)} />)}
                    </details>
                  )}
                </div>
              </article>
            );
          })}

          {(currentStreamingThought || currentStreamingAnswer) && (
            <article className="agent-message agent-message--assistant">
              <div className="agent-message__avatar"><Sparkles size={14} strokeWidth={1.5} /></div>
              <div className="agent-message__body">
                {currentStreamingThought && (
                  <details className="agent-tool-timeline" open={!currentStreamingAnswer}>
                    <summary><Sparkles size={13} />{t('Thinking')}</summary>
                    <div style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{currentStreamingThought}</div>
                  </details>
                )}
                {currentStreamingAnswer && <><MarkdownMessage content={currentStreamingAnswer} /><span className="agent-stream-cursor" /></>}
              </div>
            </article>
          )}

          {activeToolCall?.status === 'running' && (
            <div className="agent-running-card"><span className="agent-spinner" /><div><strong>{t('Running tool')}</strong><code>{activeToolCall.tool_name}</code></div></div>
          )}

          {(error || panelError) && (
            <div className="agent-error-card" role="alert"><div><strong>{t('Agent needs attention')}</strong><p>{error || panelError}</p></div><button type="button" onClick={() => { dismissError(); setPanelError(null); }} aria-label={t('Dismiss error')}><X size={15} /></button></div>
          )}
          <div ref={messagesEndRef} />
        </main>

        <footer className="agent-composer">
          <details className="agent-context-options">
            <summary><FileText size={13} /><span>{t('Notebook context')}</span><small>{injectContext ? t('{count} attached', { count: visibleContextChips.length }) : t('Off')}</small><ChevronDown size={12} /></summary>
            <div className="agent-context-options__content">
              <label><input type="checkbox" checked={injectContext} onChange={(event) => setInjectContext(event.target.checked)} />{t('Include notebook context')}</label>
              {injectContext && <>
                {visibleContextChips.length > 0 ? <div className="agent-context-chips">
                  {visibleContextChips.map((chip) => <span key={chip.id} title={chip.value}><FileText size={11} />{chip.label}<button type="button" onClick={() => setExcludedContext((items) => [...items, chip.id])} aria-label={t('Remove {name} context', { name: chip.label })}><X size={11} /></button></span>)}
                </div> : <p>{t('No notebook context attached.')}</p>}
                {excludedContext.length > 0 && <button type="button" className="agent-context-reset" onClick={() => setExcludedContext([])}>{t('Restore context')}</button>}
              </>}
            </div>
          </details>
          <div className="agent-composer__input">
            <textarea ref={inputRef} rows={1} value={inputPrompt} onChange={(event) => setInputPrompt(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); handleSend(); }
            }} placeholder={t('Ask anything about your notebook…')} title={t('Enter to send · Shift+Enter for newline')} disabled={status === 'running'} aria-label={t('Agent prompt')} />
            <div className="agent-composer__actions">
              <span>{t('Shift+Enter for a new line')}</span>
              {status === 'running' ? (
                <div><button type="button" className="stop" onClick={() => cancelTask(false)} title={t('Stop Agent')}><Square size={14} />{t('Stop')}</button><button type="button" className="interrupt" onClick={() => cancelTask(true)} title={t('Stop Agent and interrupt kernel')}><Zap size={14} /></button></div>
              ) : <button type="button" className="send" onClick={handleSend} disabled={!inputPrompt.trim()} aria-label={t('Send prompt')}><Send size={15} /></button>}
            </div>
          </div>
        </footer>
      </section>

      <ToolConfirmModal toolCall={activeToolCall} onConfirm={confirmTool} />
      {isSkillOpen && <SkillSelector onClose={() => setIsSkillOpen(false)} onSelectSkill={(skill: Skill) => setInputPrompt((current) => `/${skill.id} ${current}`.trim() + ' ')} />}
      {isKnowledgeOpen && <KnowledgeModal onClose={() => setIsKnowledgeOpen(false)} />}
      {isTraceOpen && <TraceViewerModal onClose={() => setIsTraceOpen(false)} />}

      {renameTitle !== null && <AgentDialog title={t('Rename conversation')} onClose={() => setRenameTitle(null)} actions={<><button type="button" onClick={() => setRenameTitle(null)}>{t('Cancel')}</button><button type="button" className="primary" onClick={renameSession}>{t('Save')}</button></>}><input autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void renameSession()} /></AgentDialog>}
      {deleteConfirmOpen && <AgentDialog title={t('Delete this conversation?')} onClose={() => setDeleteConfirmOpen(false)} actions={<><button type="button" onClick={() => setDeleteConfirmOpen(false)}>{t('Cancel')}</button><button type="button" className="danger" onClick={deleteSession}>{t('Delete')}</button></>}><p>{t('This removes the conversation and its history. This action cannot be undone.')}</p></AgentDialog>}
    </>
  );
};

const AgentDialog: React.FC<{ title: string; onClose: () => void; actions: React.ReactNode; children: React.ReactNode }> = ({ title, onClose, actions, children }) => (
  <div className="agent-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="agent-dialog" role="dialog" aria-modal="true" aria-label={title}><div className="agent-dialog__header"><h3>{title}</h3><button type="button" onClick={onClose} aria-label={t('Close dialog')}><X size={16} /></button></div><div className="agent-dialog__content">{children}</div><div className="agent-dialog__actions">{actions}</div></div>
  </div>
);

function buildContextChips(context: AgentChatContext): ContextChip[] {
  const chips: ContextChip[] = [];
  if (context.notebook_path) chips.push({ id: 'notebook', label: context.notebook_path.split('/').pop() || context.notebook_path, value: context.notebook_path, keys: ['notebook_path', 'server_id', 'session_id'] });
  if (context.kernel_id) chips.push({ id: 'kernel', label: localizeStatus(context.kernel_status) || t('Kernel'), value: context.kernel_id, keys: ['kernel_id', 'kernel_status'] });
  if (context.active_cell_code) chips.push({ id: 'cell', label: t('Cell {index}', { index: typeof context.active_cell_index === 'number' ? context.active_cell_index + 1 : '' }).trim(), value: context.active_cell_code, keys: ['active_cell_id', 'active_cell_index', 'active_cell_code'] });
  if (context.last_error) chips.push({ id: 'error', label: t('Last error'), value: context.last_error, keys: ['last_error'] });
  return chips;
}

function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return t('now');
  if (minutes < 60) return t('{count}m ago', { count: minutes });
  if (minutes < 1_440) return t('{count}h ago', { count: Math.round(minutes / 60) });
  return t('{count}d ago', { count: Math.round(minutes / 1_440) });
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, '').replace(/^Agent error:\s*/i, '');
}
