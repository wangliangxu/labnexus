import React, { useState, useRef, useEffect } from 'react';
import { useAgent } from '../../hooks/useAgent';
import { ToolConfirmModal } from './ToolConfirmModal';

import { SkillSelector } from './SkillSelector';
import { KnowledgeModal } from './KnowledgeModal';
import { TraceViewerModal } from './TraceViewerModal';
import type { AgentChatContext, Skill } from '../../types/agent';

interface AgentChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  getWorkspaceContext?: () => AgentChatContext;
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  isOpen,
  onClose,
  getWorkspaceContext,
}) => {
  const {
    messages,
    status,
    currentStreamingAnswer,
    activeToolCall,
    error,
    sendPrompt,
    confirmTool,
    clearHistory,
  } = useAgent('default');

  const [inputPrompt, setInputPrompt] = useState('');
  const [injectContext, setInjectContext] = useState(true);
  const [isSkillOpen, setIsSkillOpen] = useState(false);
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, currentStreamingAnswer, isOpen]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (!inputPrompt.trim() || status === 'running') return;
    const ctx = injectContext && getWorkspaceContext ? getWorkspaceContext() : undefined;
    sendPrompt(inputPrompt, ctx);
    setInputPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <div 
        className="fixed right-0 w-96 bg-dark-surface border-l border-dark-border shadow-2xl z-40 flex flex-col animate-slide-left"
        style={{ top: '40px', bottom: 'var(--statusbar-height)' }}
      >
        {/* Header */}
        <div className="p-4 border-b border-dark-border flex items-center justify-between bg-dark-bg/50">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡️</span>
            <div>
              <h3 className="text-sm font-bold text-gray-100">LabNexus Assistant</h3>
              <p className="text-[10px] text-gray-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                ReAct Agent Engine Active
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={clearHistory}
              title="Clear Chat History"
              className="p-1.5 rounded-lg hover:bg-dark-border text-gray-400 hover:text-red-400 transition-colors text-sm"
            >
              🗑️
            </button>
            <button
              onClick={onClose}
              title="Close Panel"
              className="p-1.5 rounded-lg hover:bg-dark-border text-gray-400 hover:text-white transition-colors text-sm"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          {messages.length === 0 && !currentStreamingAnswer && (
            <div className="text-center py-12 text-gray-500 space-y-2">
              <div className="text-3xl">🧪</div>
              <p className="font-semibold text-gray-400">Welcome to LabNexus AI</p>
              <p className="text-xs max-w-[240px] mx-auto">
                Ask me to write scripts, inspect variables, analyze datasets, or execute code directly in your Jupyter kernel!
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user'
                  ? 'items-end'
                  : msg.role === 'tool'
                  ? 'items-center'
                  : 'items-start'
              }`}
            >
              {msg.role === 'user' ? (
                <div className="bg-gradient-to-r from-brand-primary to-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] shadow-md whitespace-pre-wrap text-xs">
                  {msg.content}
                </div>
              ) : msg.role === 'tool' ? (
                <div className="w-full bg-dark-bg/80 border border-dark-border rounded-lg p-2 my-1 text-[11px] font-mono text-gray-400 overflow-x-auto max-h-32">
                  <span className="text-emerald-400 font-bold block mb-0.5">
                    ✓ Observation [{msg.name}]:
                  </span>
                  {msg.content}
                </div>
              ) : (
                <div className="bg-dark-bg border border-dark-border text-gray-200 px-4 py-3 rounded-2xl rounded-tl-sm max-w-[95%] shadow-sm space-y-2 text-xs">
                  {msg.content && (
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  )}

                  {msg.tool_calls && msg.tool_calls.length > 0 && (
                    <div className="border-t border-dark-border pt-2 space-y-1">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">
                        Tool Execution Requested:
                      </span>
                      {msg.tool_calls.map((tc, idx) => (
                        <div
                          key={idx}
                          className="bg-dark-surface border border-brand-primary/30 rounded px-2 py-1 flex items-center justify-between text-[11px] font-mono text-brand-primary"
                        >
                          <span>🔧 {tc.function.name}</span>
                          <span className="text-[10px] text-gray-500 truncate max-w-[120px]">
                            {tc.function.arguments}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Streaming Answer */}
          {currentStreamingAnswer && (
            <div className="flex flex-col items-start">
              <div className="bg-dark-bg border border-dark-border text-gray-200 px-4 py-3 rounded-2xl rounded-tl-sm max-w-[95%] shadow-sm whitespace-pre-wrap text-xs leading-relaxed">
                {currentStreamingAnswer}
                <span className="inline-block w-1.5 h-3 bg-brand-primary ml-1 animate-pulse" />
              </div>
            </div>
          )}

          {/* Active Tool Running Indicator */}
          {activeToolCall && activeToolCall.status === 'running' && (
            <div className="w-full bg-brand-primary/10 border border-brand-primary/30 rounded-lg p-2.5 flex items-center gap-2 text-xs text-brand-primary animate-pulse">
              <span className="animate-spin text-sm">⚡</span>
              <span className="font-mono font-semibold">
                Executing tool: {activeToolCall.tool_name}...
              </span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs p-3 rounded-lg flex items-start gap-2">
              <span>❌</span>
              <div className="flex-1 whitespace-pre-wrap">{error}</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Prompt Input Area */}
        <div className="p-3 border-t border-dark-border bg-dark-bg/80 space-y-2">
          {/* Phase 4 Shortcut Bar */}
          <div className="flex items-center justify-between px-1 border-b border-dark-border/50 pb-1.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsSkillOpen(true)}
                title="Select Scientific Workflow Skill"
                className="px-2 py-0.5 text-[10px] font-bold bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30 rounded flex items-center gap-1 transition-all shadow-sm"
              >
                ⚡ Skills
              </button>
              <button
                onClick={() => setIsKnowledgeOpen(true)}
                title="Domain Knowledge Base"
                className="px-2 py-0.5 text-[10px] font-bold bg-dark-surface hover:bg-dark-border text-gray-300 border border-dark-border rounded flex items-center gap-1 transition-all"
              >
                📚 Knowledge
              </button>
              <button
                onClick={() => setIsTraceOpen(true)}
                title="Execution Traces & Audit Logs"
                className="px-2 py-0.5 text-[10px] font-bold bg-dark-surface hover:bg-dark-border text-gray-300 border border-dark-border rounded flex items-center gap-1 transition-all"
              >
                📊 Traces
              </button>
            </div>
            {injectContext && (
              <span className="text-[9px] bg-brand-primary/10 text-brand-primary px-1.5 py-0.5 rounded border border-brand-primary/20">
                Active Cell & Logs
              </span>
            )}
          </div>

          {/* Context Checkbox */}
          <div className="flex items-center justify-between px-1">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer hover:text-gray-300">
              <input
                type="checkbox"
                checked={injectContext}
                onChange={(e) => setInjectContext(e.target.checked)}
                className="rounded border-dark-border bg-dark-surface text-brand-primary focus:ring-0 w-3 h-3 accent-brand-primary"
              />
              <span>Auto-inject Notebook Context</span>
            </label>
          </div>

          <div className="relative">
            <textarea
              rows={2}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask LabNexus AI anything... (Press Enter to send, or / for skills)"
              disabled={status === 'running'}
              className="w-full bg-dark-surface border border-dark-border rounded-xl px-3 py-2 pr-10 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-primary resize-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!inputPrompt.trim() || status === 'running'}
              className="absolute right-2 bottom-2 p-1.5 rounded-lg bg-brand-primary hover:bg-brand-primary/80 text-white disabled:opacity-30 disabled:hover:bg-brand-primary transition-all shadow-md"
            >
              ➤
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ToolConfirmModal toolCall={activeToolCall} onConfirm={confirmTool} />
      {isSkillOpen && (
        <SkillSelector
          onClose={() => setIsSkillOpen(false)}
          onSelectSkill={(skill: Skill) => {
            setInputPrompt((prev) => `/${skill.id} ${prev}`.trim() + ' ');
          }}
        />
      )}
      {isKnowledgeOpen && (
        <KnowledgeModal onClose={() => setIsKnowledgeOpen(false)} />
      )}
      {isTraceOpen && (
        <TraceViewerModal onClose={() => setIsTraceOpen(false)} />
      )}
    </>
  );
};

