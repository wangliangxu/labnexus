import { t } from '../../i18n';
/**
 * ConnectionPanel — Server connection form with proxy configuration.
 */

import { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { JupyterServerConfig, JupyterHubLoginConfig, ProxyConfig, RemoteJupyterLaunch } from '../../types/jupyter';
import './ConnectionPanel.css';

interface ConnectionPanelProps {
  onConnect: (config: JupyterServerConfig) => Promise<void>;
  onConnectHub?: (config: JupyterHubLoginConfig) => Promise<void>;
  onStartRemote: (launch: RemoteJupyterLaunch, name?: string) => Promise<void>;
  onBack?: () => void;
  isConnecting: boolean;
}

export function ConnectionPanel({
  onConnect,
  onConnectHub,
  onStartRemote,
  onBack,
  isConnecting,
}: ConnectionPanelProps) {
  const [startViaSsh, setStartViaSsh] = useState(false);
  const [remotePython, setRemotePython] = useState('');
  const [authMode, setAuthMode] = useState<'token' | 'tljh'>('token');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showProxy, setShowProxy] = useState(false);
  const [proxyType, setProxyType] = useState<ProxyConfig['proxy_type']>('socks5');
  const [sshAlias, setSshAlias] = useState('');
  const [proxyHost, setProxyHost] = useState('127.0.0.1');
  const [proxyPort, setProxyPort] = useState('1080');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (startViaSsh) {
      if (sshAlias.trim()) {
        await onStartRemote({ alias: sshAlias.trim(), python: remotePython.trim() }, name.trim() || undefined);
      }
      return;
    }
    if (!url.trim()) return;

    let proxy: ProxyConfig | undefined;
    if (showProxy) {
      proxy = proxyType === 'ssh'
        ? { proxy_type: 'ssh', host: sshAlias.trim() }
        : { proxy_type: proxyType, host: proxyHost, port: parseInt(proxyPort, 10) };
    }

    if (authMode === 'tljh') {
      if (!username.trim() || !password) return;
      if (onConnectHub) {
        await onConnectHub({
          id: crypto.randomUUID(),
          name: name.trim() || `${username.trim()} @ ${new URL(url).hostname}`,
          url: url.trim().replace(/\/$/, ''),
          username: username.trim(),
          password,
          proxy,
        });
      }
    } else {
      const config: JupyterServerConfig = {
        id: crypto.randomUUID(),
        name: name.trim() || new URL(url).hostname,
        base_url: url.trim().replace(/\/$/, ''),
        token: token.trim() || undefined,
        proxy,
      };

      await onConnect(config);
    }
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
        <h3 className="panel-header__title">{t('Connect to Server')}</h3>
        {onBack && (
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={onBack}
            title={t('Back to Explorer')}
            aria-label={t('Back to Explorer')}
          >
            <ArrowLeft size={14} />
          </button>
        )}
      </div>

      <div className="auth-mode-tabs">
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
      </div>

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

            {/* Auth Mode Tabs */}
            <div className="auth-mode-tabs">
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
            </div>

            {authMode === 'token' ? (
              <div className="form-group animate-slide-in">
                <label className="form-label" htmlFor="conn-token">
                  {t('Token')}
                </label>
                <input
                  id="conn-token"
                  type="password"
                  placeholder={t('Authentication token')}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
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
                  <p className="form-hint">
                    {t('For SSH tunnel:')} <code>ssh -D 1080 user@server</code>
                  </p>
                )}
              </div>
            )}
          </>
        )}

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
              <span>{t('Connecting...')}</span>
            </span>
          ) : (
            t(startViaSsh ? 'Start and connect' : 'Connect')
          )}
        </button>
      </form>
    </div>
  );
}
