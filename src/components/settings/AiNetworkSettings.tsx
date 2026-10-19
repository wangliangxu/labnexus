import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { AiNetworkConfig, AiProxyConfig, AiProxyTestResult } from '../../types/agent';
import { agentTestAiProxy } from '../../services/tauriIpc';

export const DEFAULT_AI_NETWORK: AiNetworkConfig = {
  remote: { mode: 'system', url: 'http://127.0.0.1:7890' },
  chatgpt: { mode: 'system', url: 'http://127.0.0.1:7890' },
};

function ProxyCard({ route, value, baseUrl, onChange }: {
  route: 'remote' | 'chatgpt'; value: AiProxyConfig; baseUrl: string;
  onChange: (proxy: AiProxyConfig) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AiProxyTestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const signature = JSON.stringify([route, value.mode, value.url, baseUrl]);
  const latest = useRef(signature);
  latest.current = signature;
  useEffect(() => { setResults([]); setError(null); }, [signature]);
  const messages: Record<string, string> = {
    'Proxy authentication required': t('Proxy authentication required'),
    'Connection established; model access and account eligibility are not checked': t('Connection established; model access and account eligibility are not checked'),
    'Server responded, but the endpoint is unavailable or denied the request': t('Server responded, but the endpoint is unavailable or denied the request'),
    'Connection timed out': t('Connection timed out'),
    'Connection failed; check proxy port, VPN routing, DNS and TLS certificates': t('Connection failed; check proxy port, VPN routing, DNS and TLS certificates'),
    'Unable to complete connection test': t('Unable to complete connection test'),
  };
  const test = async () => {
    setBusy(true); setResults([]); setError(null);
    try {
      const result = await agentTestAiProxy(route, value, baseUrl);
      if (latest.current === signature) setResults(result);
    } catch (cause) { if (latest.current === signature) setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="rounded-xl border border-dark-border bg-dark-bg/35 p-4 space-y-3">
    <div>
      <h4 className="text-sm font-semibold">{route === 'chatgpt' ? t('ChatGPT subscription proxy') : t('Remote API key proxy')}</h4>
      <p className="text-xs text-nb-text-secondary mt-1">{route === 'chatgpt'
        ? t('Applies to token exchange, identity verification, renewal, model lists and ChatGPT inference.')
        : t('Applies to remote model requests authenticated with an API key, including DeepSeek.')}</p>
    </div>
    <label className="block space-y-1">
      <span className="text-xs text-nb-text-secondary">{t('Proxy mode')}</span>
      <select value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as AiProxyConfig['mode'] })}
        className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm">
        <option value="system">{t('Follow system (default)')}</option>
        <option value="manual">{t('Manual proxy')}</option>
        <option value="direct">{t('Direct connection')}</option>
      </select>
    </label>
    {value.mode === 'manual' && <label className="block space-y-1">
      <span className="text-xs text-nb-text-secondary">{t('Proxy URL')}</span>
      <input type="text" value={value.url} onChange={(event) => onChange({ ...value, url: event.target.value })}
        placeholder="http://127.0.0.1:7890"
        spellCheck={false} autoComplete="off"
        className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm font-mono" />
      <span className="block text-[11px] text-nb-text-secondary">{t('HTTP / HTTPS / SOCKS5 / SOCKS5H. Example: socks5h://127.0.0.1:7891. SOCKS5H also resolves DNS through the proxy. Proxy credentials in URLs are not supported.')}</span>
    </label>}
    <button type="button" disabled={busy} onClick={() => void test()}
      className="rounded-lg border border-dark-border px-3 py-2 text-xs hover:bg-dark-border disabled:opacity-50">
      {busy ? t('Testing connection...') : t('Test connection')}
    </button>
    <p className="text-[11px] text-nb-text-secondary">{t('Tests the current form without saving. No API keys, login tokens or model requests are sent. HTTP 401 confirms reachability only.')}</p>
    <div aria-live="polite" className="space-y-2">
      {results.map((result) => <div key={result.target} className={`rounded-lg border p-3 text-xs ${result.reachable ? 'border-green-500/30 text-green-500' : 'border-red-500/30 text-red-400'}`}>
        <div className="font-medium">{result.reachable ? t('Reachable') : t('Connection unavailable')} · {result.status ? `HTTP ${result.status} · ` : ''}{result.latency_ms} ms</div>
        <div className="mt-1 break-all text-nb-text-secondary">{result.target}</div>
        <p className="mt-1">{messages[result.detail] || result.detail}</p>
      </div>)}
      {error && <p role="alert" className="text-xs text-red-400 break-words">{error}</p>}
    </div>
  </div>;
}

export function AiNetworkSettings({ value, baseUrl, onChange }: {
  value: AiNetworkConfig; baseUrl: string; onChange: (network: AiNetworkConfig) => void;
}) {
  return <div className="space-y-4">
    <div className="rounded-lg border border-brand-primary/25 bg-brand-primary/10 p-3 text-xs leading-relaxed text-nb-text-secondary">
      {t('Save AI settings before signing in to apply proxy changes. New AI tasks use the saved route immediately. Local Ollama and loopback addresses stay direct; Jupyter connections are separate.')}
      <p className="mt-2">{t('Direct mode disables application proxies; routing imposed by a VPN or TUN is still controlled by the operating system.')}</p>
      <p className="mt-2">{t('The system browser still uses its own system or VPN settings. Keep 127.0.0.1 and localhost excluded from the browser proxy for the sign-in callback.')}</p>
    </div>
    <ProxyCard route="remote" value={value.remote} baseUrl={baseUrl} onChange={(remote) => onChange({ ...value, remote })} />
    <ProxyCard route="chatgpt" value={value.chatgpt} baseUrl={baseUrl} onChange={(chatgpt) => onChange({ ...value, chatgpt })} />
  </div>;
}
