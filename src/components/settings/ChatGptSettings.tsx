import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { ChatGptModel, ChatGptStatus, RemoteApiConfig } from '../../types/agent';
import {
  agentChatGptStatus, agentChatGptLogin, agentChatGptCancelLogin,
  agentChatGptModels, agentChatGptLogout, agentChatGptManageUsage,
} from '../../services/tauriIpc';

const WELCOME_KEY = 'labnexus:chatgpt-plan-welcome';
export function ChatGptSettings({ value, onChange }: {
  value: RemoteApiConfig; onChange: (remote: RemoteApiConfig) => void;
}) {
  const [status, setStatus] = useState<ChatGptStatus | null>(null);
  const [models, setModels] = useState<ChatGptModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [welcome, setWelcome] = useState(false);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const selectedId = value.chatgpt_profile_id || '';
  const selected = status?.accounts.find((account) => account.id === selectedId);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasPending = false;
    const refresh = async () => {
      try {
        const next = await agentChatGptStatus();
        if (disposed) return;
        setStatus(next);
        const props = current.current;
        if (next.active_id && (!props.value.chatgpt_profile_id || (wasPending && !next.pending))) {
          props.onChange({ ...props.value, chatgpt_profile_id: next.active_id });
        }
        if (!next.pending && next.accounts.some((account) => account.connected)) {
          try { if (!localStorage.getItem(WELCOME_KEY)) setWelcome(true); } catch { /* Storage unavailable. */ }
        }
        wasPending = next.pending;
        if (next.pending) timer = setTimeout(refresh, 1500);
      } catch (cause) { if (!disposed) setError(String(cause)); }
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [nonce]);

  useEffect(() => {
    let disposed = false;
    setModels([]);
    setLoadingModels(false);
    if (!selected?.connected) return;
    setLoadingModels(true);
    void agentChatGptModels(selectedId).then((catalog) => {
      if (disposed) return;
      setModels(catalog);
      setError(null);
      const props = current.current;
      if (catalog.length && !catalog.some((model) => model.slug === props.value.chatgpt_model)) {
        props.onChange({ ...props.value, chatgpt_model: catalog[0].slug, thinking_mode: 'auto' });
      }
    }).catch((cause) => { if (!disposed) setError(String(cause)); })
      .finally(() => { if (!disposed) setLoadingModels(false); });
    return () => { disposed = true; };
  }, [selectedId, selected?.connected, nonce]);

  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); setNonce((value) => value + 1); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const buttonClass = 'rounded-lg border border-dark-border px-3 py-2 text-xs hover:bg-dark-border disabled:opacity-50';
  return <div className="rounded-lg border border-dark-border p-4 space-y-3">
    <div className="font-semibold text-sm">{t('Use your ChatGPT plan')}</div>
    <p className="text-xs leading-relaxed text-nb-text-secondary">{t('Eligible Plus and Pro accounts can authorize plan usage in the system browser. Availability and limits depend on your account and workspace.')}</p>
    <p className="text-xs text-nb-text-secondary">Responses API · {t('No API key required')}</p>
    {status && status.accounts.length > 0 && <label className="block space-y-1">
      <span className="text-xs text-nb-text-secondary">{t('ChatGPT account')}</span>
      <select value={selectedId} disabled={busy || status.pending}
        onChange={(event) => onChange({ ...value, chatgpt_profile_id: event.target.value })}
        className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm">
        <option value="" disabled>{t('Select an account')}</option>
        {status.accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.connected ? t('Connected') : t('Sign-in required')}</option>)}
      </select>
    </label>}
    <div className="flex flex-wrap gap-2 items-center">
      <button type="button" disabled={busy || status?.pending} onClick={() => void action(() => agentChatGptLogin(selectedId || undefined))}
        className="rounded-lg bg-nb-text text-dark-surface px-4 py-2 text-sm font-semibold disabled:opacity-50">Continue with ChatGPT</button>
      {!!status?.accounts.length && <button type="button" className={buttonClass} disabled={busy || status.pending}
        onClick={() => void action(() => agentChatGptLogin())}>{t('Add another account')}</button>}
      {status?.pending && <button type="button" className={buttonClass} disabled={busy}
        onClick={() => void action(agentChatGptCancelLogin)}>{t('Cancel sign-in')}</button>}
      {selected?.connected && <button type="button" className={buttonClass} disabled={busy || status?.pending}
        onClick={() => void action(async () => {
          const warning = await agentChatGptLogout(selectedId);
          if (warning) setError(warning);
        })}>{t('Sign out')}</button>}
      <button type="button" className={buttonClass} onClick={() => void action(agentChatGptManageUsage)}>{t('Manage ChatGPT usage')}</button>
    </div>
    {status?.pending && <p role="status" className="text-xs text-nb-text-secondary">{t('Complete sign-in and plan authorization in your browser. This page will update automatically.')}</p>}
    <label className="block space-y-1">
      <span className="text-xs text-nb-text-secondary">{t('Model')}</span>
      <select value={value.chatgpt_model || 'gpt-6.1-sol'} disabled={busy || loadingModels || !models.length}
        onChange={(event) => onChange({ ...value, chatgpt_model: event.target.value, thinking_mode: 'auto' })}
        className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm disabled:opacity-50">
        {!models.length && <option value={value.chatgpt_model || 'gpt-6.1-sol'}>{loadingModels ? t('Loading models...') : t('Sign in to load available models')}</option>}
        {models.map((model) => <option value={model.slug} key={model.slug}>{model.display_name}</option>)}
      </select>
    </label>
    {(error || status?.error) && <p role="alert" className="text-xs text-red-400 break-words">{error || status?.error}</p>}
    <p className="text-xs text-nb-text-secondary">{t('Save AI settings to use the selected account and model. Subscription limits do not switch requests to paid API billing.')}</p>
    {welcome && <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6" style={{ zIndex: 'calc(var(--z-modal) + 1)' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="chatgpt-welcome-title" className="max-w-sm bg-dark-surface border border-dark-border rounded-xl p-6 space-y-4">
        <h3 id="chatgpt-welcome-title" className="font-semibold">{t('You are using your ChatGPT plan')}</h3>
        <p className="text-sm text-nb-text-secondary">{t('Eligible requests use your ChatGPT plan or available credits. You can manage app access and usage in ChatGPT settings.')}</p>
        <button type="button" className={buttonClass} onClick={() => {
          try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* Storage unavailable. */ }
          setWelcome(false);
        }}>{t('Got it')}</button>
      </div>
    </div>}
  </div>;
}
