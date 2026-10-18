import { t } from '../../i18n';
import React, { useEffect } from 'react';
import { AlertTriangle, Check, ChevronRight, Clock, Server, ShieldAlert, X } from 'lucide-react';
import type { AgentToolCallEvent } from '../../types/agent';

interface ToolConfirmModalProps {
  toolCall: AgentToolCallEvent | null;
  onConfirm: (approved: boolean, scope?: 'once' | 'session') => void;
}

export const ToolConfirmModal: React.FC<ToolConfirmModalProps> = ({ toolCall, onConfirm }) => {
  const visible = Boolean(toolCall && toolCall.status === 'requires_confirmation');
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onConfirm(false, 'once');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, visible]);

  if (!toolCall || !visible) return null;
  const risk = toolCall.risk_level || 'high';
  const summary = summarizeAction(toolCall);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-dark-border bg-dark-surface shadow-2xl animate-scale-up" role="dialog" aria-modal="true" aria-labelledby="tool-confirm-title">
        <div className="flex items-start justify-between gap-4 border-b border-dark-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${riskTone(risk)}`}><ShieldAlert size={20} /></div>
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${riskTone(risk)}`}>{t(risk)}</span>
                <span className="text-xs text-gray-400">{t('Approval required')}</span>
              </div>
              <h2 id="tool-confirm-title" className="text-base font-bold text-gray-100">{summary.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">{summary.description}</p>
            </div>
          </div>
          <button type="button" onClick={() => onConfirm(false, 'once')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-dark-border hover:text-gray-100" aria-label={t('Deny and close')}><X size={17} /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-dark-border bg-dark-bg/60 p-3"><span className="mb-1 flex items-center gap-1.5 text-gray-500"><Server size={12} />{t('Tool')}</span><code className="break-all text-brand-primary">{toolCall.tool_name}</code></div>
            <div className="rounded-lg border border-dark-border bg-dark-bg/60 p-3"><span className="mb-1 flex items-center gap-1.5 text-gray-500"><Clock size={12} />{t('Approval scope')}</span><span className="text-gray-200">{toolCall.allow_session ? t('Once or this session') : t('This action only')}</span></div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} />{t('Why this needs review')}</div>
            <p className="text-amber-100/75">{toolCall.confirmation_reason || t('This tool may read external data or change the current workspace.')}</p>
          </div>

          {summary.targets.length > 0 && <div><h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t('Affected targets')}</h3><div className="flex flex-wrap gap-1.5">{summary.targets.map((target) => <span key={target} className="inline-flex max-w-full items-center gap-1 rounded-md border border-dark-border bg-dark-bg px-2 py-1 font-mono text-[11px] text-gray-300"><ChevronRight size={11} /><span className="truncate">{target}</span></span>)}</div></div>}

          <details className="group rounded-lg border border-dark-border bg-dark-bg/50">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-gray-300 hover:text-gray-100">{t('Review raw parameters')}</summary>
            <pre className="max-h-56 overflow-auto border-t border-dark-border p-3 text-[11px] leading-relaxed text-gray-300">{JSON.stringify(toolCall.arguments, null, 2)}</pre>
          </details>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dark-border bg-dark-bg/45 px-5 py-3">
          <button autoFocus type="button" onClick={() => onConfirm(false, 'once')} className="rounded-lg border border-dark-border px-4 py-2 text-xs font-semibold text-gray-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300">{t('Deny')}</button>
          {toolCall.allow_session && <button type="button" onClick={() => onConfirm(true, 'session')} className="rounded-lg border border-emerald-500/30 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10">{t('Allow for session')}</button>}
          <button type="button" onClick={() => onConfirm(true, 'once')} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-4 py-2 text-xs font-bold text-white shadow-lg shadow-brand-primary/20 hover:bg-brand-primary/85"><Check size={14} />{t('Approve once')}</button>
        </div>
      </div>
    </div>
  );
};

function summarizeAction(toolCall: AgentToolCallEvent): { title: string; description: string; targets: string[] } {
  const name = toolCall.tool_name;
  const args = toolCall.arguments;
  const targets = ['path', 'uri', 'url', 'command', 'code', 'notebook_path']
    .flatMap((key) => typeof args[key] === 'string' ? [String(args[key]).slice(0, key === 'code' ? 120 : 240)] : [])
    .slice(0, 4);
  if (name.includes('execute')) return { title: t('Run code in the active environment?'), description: t('Review the code and its target before allowing execution. It may modify kernel state or access external systems.'), targets };
  if (name.includes('read')) return { title: t('Allow this data to be read?'), description: t('The result may be added to the Agent conversation and sent to the configured model provider.'), targets };
  if (name.includes('restart')) return { title: t('Restart the active kernel?'), description: t('This clears in-memory variables and interrupts current computation.'), targets };
  if (name.includes('save') || name.includes('add') || name.includes('write')) return { title: t('Allow this workspace change?'), description: t('The action will modify notebook or external system state.'), targets };
  return { title: t('Allow {name}?', { name }), description: t('This external capability may read data or perform side effects outside the conversation.'), targets };
}

function riskTone(risk: string): string {
  if (risk === 'critical' || risk === 'high') return 'bg-red-500/12 text-red-300 border border-red-500/25';
  if (risk === 'mutation') return 'bg-amber-500/12 text-amber-300 border border-amber-500/25';
  if (risk === 'sensitive') return 'bg-violet-500/12 text-violet-300 border border-violet-500/25';
  return 'bg-blue-500/12 text-blue-300 border border-blue-500/25';
}
