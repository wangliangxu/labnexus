import { t } from '../../i18n';
/**
 * ConnectionPanel — Server connection form with proxy configuration.
 */

import { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { JupyterServerConfig, JupyterHubLoginConfig, ProxyConfig, RemoteJupyterLaunch } from '../../types/jupyter';
import { REDACTED_SERVER_SECRET } from '../../hooks/jupyterServerStorage';
import './ConnectionPanel.css';

interface ConnectionPanelProps {
  onConnect: (config: JupyterServerConfig) => Promise<void>;
  onConnectHub?: (config: JupyterHubLoginConfig) => Promise<void>;
  onStartRemote: (launch: RemoteJupyterLaunch, name?: string) => Promise<void>;
  editConfig?: JupyterServerConfig;
  onSave?: (config: JupyterServerConfig) => Promise<void>;
  onBack?: () => void;
  isConnecting: boolean;
}

export function ConnectionPanel({
  onConnect,
  onConnectHub,
  onStartRemote,
  editConfig,
  onSave,
  onBack,
  isConnecting,
}: ConnectionPanelProps) {
  const [startViaSsh, setStartViaSsh] = useState(Boolean(editConfig?.remote_launch));
  const [remotePython, setRemotePython] = useState(editConfig?.remote_launch?.python ?? '');
  const [authMode, setAuthMode] = useState<'token' | 'tljh'>('token');
  const [name, setName] = useState(editConfig?.name ?? '');
  const [url, setUrl] = useState(editConfig?.base_url ?? '');
  const [token, setToken] = useState('');
  const [removeToken, setRemoveToken] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const savedProxy = editConfig?.proxy;
  const [showProxy, setShowProxy] = useState(Boolean(savedProxy));
  const [proxyType, setProxyType] = useState<ProxyConfig['proxy_type']>(savedProxy?.proxy_type ?? 'socks5');
  const [sshAlias, setSshAlias] = useState(editConfig?.remote_launch?.alias ?? (savedProxy?.proxy_type === 'ssh' ? savedProxy.host : ''));
  const [proxyHost, setProxyHost] = useState(savedProxy && savedProxy.proxy_type !== 'ssh' ? savedProxy.host : '127.0.0.1');
  const [proxyPort, setProxyPort] = useState(String(savedProxy?.port || 1080));
  const [proxyUsername, setProxyUsername] = useState(savedProxy?.username ?? '');
  const [proxyPassword, setProxyPassword] = useState('');
  const [removeProxyPassword, setRemoveProxyPassword] = useState(false);
  const [validationError, setValidationError] = useState<string>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(undefined);
    if (startViaSsh) {
      const alias = sshAlias.trim();
      const python = remotePython.trim() || 'python3';
      if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(alias)) {
        setValidationError(t('Enter a valid SSH host alias.'));
        return;
      }
      if (/^-|[\x00-\x1f\x7f]/.test(python)) {
        setValidationError(t('Enter a valid remote Python executable.'));
        return;
      }
      if (editConfig && onSave) {
        await onSave({
          ...editConfig,
          name: name.trim() || `Jupyter @ ${alias}`,
          base_url: '',
          token: undefined,
          proxy: { proxy_type: 'ssh', host: alias },
          remote_launch: { alias, python },
        });
      } else {
        await onStartRemote({ alias, python }, name.trim() || undefined);
      }
      return;
    }

    let serverUrl: URL;
    try {
      serverUrl = new URL(url.trim());
      if (!['http:', 'https:'].includes(serverUrl.protocol)) throw new Error();
    } catch {
      setValidationError(t('Enter a valid HTTP or HTTPS server URL.'));
      return;
    }

    let proxy: ProxyConfig | undefined;
    if (showProxy) {
      if (proxyType === 'ssh') {
        if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(sshAlias.trim())) {
          setValidationError(t('Enter a valid SSH host alias.'));
          return;
        }
        proxy = { proxy_type: 'ssh', host: sshAlias.trim() };
      } else {
        const port = Number(proxyPort);
        if (!proxyHost.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
          setValidationError(t('Enter a proxy host and a port from 1 to 65535.'));
          return;
        }
        proxy = {
          proxy_type: proxyType,
          host: proxyHost.trim(),
          port,
          username: proxyType === 'socks5' ? proxyUsername.trim() || undefined : undefined,
          password: proxyType === 'socks5'
            ? removeProxyPassword
              ? ''
              : proxyPassword || (savedProxy?.password ? REDACTED_SERVER_SECRET : undefined)
            : undefined,
        };
      }
    }

    const baseUrl = url.trim().replace(/\/$/, '');
    if (authMode === 'tljh') {
      if (!username.trim() || !password) return;
      await onConnectHub?.({
        id: crypto.randomUUID(),
        name: name.trim() || `${username.trim()} @ ${serverUrl.hostname}`,
        url: baseUrl,
        username: username.trim(),
        password,
        proxy,
      });
      return;
    }

    const config: JupyterServerConfig = {
      id: editConfig?.id ?? crypto.randomUUID(),
      name: name.trim() || serverUrl.hostname,
      base_url: baseUrl,
      token: removeToken
        ? ''
        : token.trim() || (editConfig?.token ? REDACTED_SERVER_SECRET : undefined),
      proxy,
    };
    if (editConfig && onSave) await onSave(config);
    else await onConnect(config);
  };

  const sshAliasField = (
    <div className="form-group">
      <label className="form-label" htmlFor="ssh-alias">{t('SSH host alias')}</label>
      <input
        id="ssh-alias"
        type="text"
        placeholder="lab-server"
        aria-describedby="ssh-alias-hint"
        value={sshAlias}
        onChange={(e) => setSshAlias(e.target.value)}
        required
      />
      <p id="ssh-alias-hint" className="form-hint">
        {t('Use a Host alias from ~/.ssh/config.')}
      </p>
    </div>
  );

  return (
    <div className="connection-panel">
      <div className="panel-header">
        <h3 className="panel-header__title">{t(editConfig ? 'Edit server connection' : 'Connect to Server')}</h3>
        {onBack && (
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={onBack}
            disabled={isConnecting}
            title={t(editConfig ? 'Cancel' : 'Back to Explorer')}
            aria-label={t(editConfig ? 'Cancel' : 'Back to Explorer')}
          >
            <ArrowLeft size={14} />
          </button>
        )}
      </div>

      {!editConfig && <div className="auth-mode-tabs">
        <button
          type="button"
          className={`auth-mode-tab ${!startViaSsh ? 'active' : ''}`}
          aria-pressed={!startViaSsh}
          disabled={isConnecting}
          onClick={() => setStartViaSsh(false)}
        >
          {t('Connect to running server')}
        </button>
        <button
          type="button"
          className={`auth-mode-tab ${startViaSsh ? 'active' : ''}`}
          aria-pressed={startViaSsh}
          disabled={isConnecting}
          onClick={() => setStartViaSsh(true)}
        >
          {t('Start via SSH')}
        </button>
      </div>}

      <form className="connection-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="conn-name">
            {t('Name')}
          </label>
          <input
            id="conn-name"
            type="text"
            placeholder={t('My Jupyter Server')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {startViaSsh ? (
          <>
            {sshAliasField}
            <div className="form-group">
              <label className="form-label" htmlFor="remote-python">{t('Remote Python executable')}</label>
              <input
                id="remote-python"
                type="text"
                placeholder="python3"
                aria-describedby="remote-python-hint"
                value={remotePython}
                onChange={(e) => setRemotePython(e.target.value)}
              />
              <p id="remote-python-hint" className="form-hint">
                {t('Leave blank for python3, or enter the Python path in your remote environment.')}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="conn-url">
                {t('Server URL')} <span className="required">*</span>
              </label>
              <input
                id="conn-url"
                type="text"
                placeholder="http://localhost:8888"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>

            {!editConfig && <div className="auth-mode-tabs">
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'token' ? 'active' : ''}`}
                onClick={() => setAuthMode('token')}
              >
                {t('Token Auth')}
              </button>
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'tljh' ? 'active' : ''}`}
                onClick={() => setAuthMode('tljh')}
              >
                {t('TLJH / Login')}
              </button>
            </div>}

            {authMode === 'token' ? (
              <div className="form-group animate-slide-in">
                <label className="form-label" htmlFor="conn-token">
                  {t('Token')}
                </label>
                <input
                  id="conn-token"
                  type="password"
                  placeholder={t(editConfig?.token ? 'Leave blank to keep the saved token' : 'Authentication token')}
                  autoComplete="new-password"
                  disabled={removeToken}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                {editConfig?.token && (
                  <label className="form-checkbox">
                    <input type="checkbox" checked={removeToken} onChange={(e) => setRemoveToken(e.target.checked)} />
                    {t('Remove saved token')}
                  </label>
                )}
              </div>
            ) : (
              <div className="tljh-auth-fields animate-slide-in">
                <div className="form-group">
                  <label className="form-label" htmlFor="conn-username">
                    {t('Username')} <span className="required">*</span>
                  </label>
                  <input
                    id="conn-username"
                    type="text"
                    placeholder={t('JupyterHub username')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required={authMode === 'tljh'}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="conn-password">
                    {t('Password')} <span className="required">*</span>
                  </label>
                  <input
                    id="conn-password"
                    type="password"
                    placeholder={t('JupyterHub password')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={authMode === 'tljh'}
                  />
                </div>
              </div>
            )}

            {/* Proxy Toggle */}
            <div className="form-group">
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={showProxy}
                  onChange={(e) => setShowProxy(e.target.checked)}
                />
                <span>{t('Use Proxy')}</span>
              </label>
            </div>

            {/* Proxy Configuration */}
            {showProxy && (
              <div className="proxy-config animate-slide-in">
                <div className="form-group">
                  <label className="form-label" htmlFor="proxy-type">
                    {t('Proxy Type')}
                  </label>
                  <select
                    id="proxy-type"
                    value={proxyType}
                    onChange={(e) =>
                      setProxyType(e.target.value as ProxyConfig['proxy_type'])
                    }
                  >
                    <option value="socks5">SOCKS5 (SSH -D)</option>
                    <option value="http">HTTP</option>
                    {savedProxy?.proxy_type === 'https' && <option value="https">HTTPS</option>}
                    <option value="ssh">{t('SSH alias')}</option>
                  </select>
                </div>

                {proxyType === 'ssh' ? (
                  sshAliasField
                ) : (
                  <div className="form-row">
                    <div className="form-group form-group--flex">
                      <label className="form-label" htmlFor="proxy-host">
                        {t('Host')}
                      </label>
                      <input
                        id="proxy-host"
                        type="text"
                        placeholder="127.0.0.1"
                        value={proxyHost}
                        onChange={(e) => setProxyHost(e.target.value)}
                      />
                    </div>
                    <div className="form-group form-group--port">
                      <label className="form-label" htmlFor="proxy-port">
                        {t('Port')}
                      </label>
                      <input
                        id="proxy-port"
                        type="number"
                        placeholder="1080"
                        value={proxyPort}
                        onChange={(e) => setProxyPort(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {proxyType === 'socks5' && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="proxy-username">{t('Proxy username')}</label>
                      <input id="proxy-username" value={proxyUsername} onChange={(e) => setProxyUsername(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="proxy-password">{t('Proxy password')}</label>
                      <input
                        id="proxy-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder={savedProxy?.password ? t('Leave blank to keep the saved password') : undefined}
                        disabled={removeProxyPassword}
                        value={proxyPassword}
                        onChange={(e) => setProxyPassword(e.target.value)}
                      />
                      {savedProxy?.password && (
                        <label className="form-checkbox">
                          <input type="checkbox" checked={removeProxyPassword} onChange={(e) => setRemoveProxyPassword(e.target.checked)} />
                          {t('Remove saved proxy password')}
                        </label>
                      )}
                    </div>
                    {!editConfig && (
                      <p className="form-hint">{t('For SSH tunnel:')} <code>ssh -D 1080 user@server</code></p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {editConfig && <p className="form-hint">{t('Changes apply the next time you connect.')}</p>}
        {validationError && <p role="alert" className="form-hint text-red-400">{validationError}</p>}

        <button
          type="submit"
          className="btn btn-primary connect-btn"
          disabled={
            isConnecting ||
            (startViaSsh
              ? !sshAlias.trim()
              : !url.trim() ||
                (showProxy && proxyType === 'ssh' && !sshAlias.trim()) ||
                (authMode === 'tljh' && (!username.trim() || !password)))
          }
        >
          {isConnecting ? (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Loader2 size={14} className="animate-spin" />
              <span>{t(editConfig ? 'Saving...' : 'Connecting...')}</span>
            </span>
          ) : (
            t(editConfig ? 'Save changes' : startViaSsh ? 'Start and connect' : 'Connect')
          )}
        </button>
      </form>
    </div>
  );
}
