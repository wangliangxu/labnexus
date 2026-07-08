/**
 * ConnectionPanel — Server connection form with proxy configuration.
 */

import { useState } from 'react';
import type { JupyterServerConfig, JupyterHubLoginConfig, ProxyConfig } from '../../types/jupyter';
import './ConnectionPanel.css';

interface ConnectionPanelProps {
  onConnect: (config: JupyterServerConfig) => Promise<void>;
  onConnectHub?: (config: JupyterHubLoginConfig) => Promise<void>;
  isConnecting: boolean;
}

export function ConnectionPanel({ onConnect, onConnectHub, isConnecting }: ConnectionPanelProps) {
  const [authMode, setAuthMode] = useState<'token' | 'tljh'>('token');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showProxy, setShowProxy] = useState(false);
  const [proxyType, setProxyType] = useState<'socks5' | 'http'>('socks5');
  const [proxyHost, setProxyHost] = useState('127.0.0.1');
  const [proxyPort, setProxyPort] = useState('1080');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    const proxy: ProxyConfig | undefined = showProxy
      ? {
          proxy_type: proxyType,
          host: proxyHost,
          port: parseInt(proxyPort, 10),
        }
      : undefined;

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

  return (
    <div className="connection-panel">
      <div className="panel-header">
        <h3 className="panel-header__title">Connect to Server</h3>
      </div>

      <form className="connection-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="conn-name">
            Name
          </label>
          <input
            id="conn-name"
            type="text"
            placeholder="My Jupyter Server"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="conn-url">
            Server URL <span className="required">*</span>
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
            Token Auth
          </button>
          <button
            type="button"
            className={`auth-mode-tab ${authMode === 'tljh' ? 'active' : ''}`}
            onClick={() => setAuthMode('tljh')}
          >
            TLJH / Login
          </button>
        </div>

        {authMode === 'token' ? (
          <div className="form-group animate-slide-in">
            <label className="form-label" htmlFor="conn-token">
              Token
            </label>
            <input
              id="conn-token"
              type="password"
              placeholder="Authentication token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
        ) : (
          <div className="tljh-auth-fields animate-slide-in">
            <div className="form-group">
              <label className="form-label" htmlFor="conn-username">
                Username <span className="required">*</span>
              </label>
              <input
                id="conn-username"
                type="text"
                placeholder="JupyterHub username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required={authMode === 'tljh'}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="conn-password">
                Password <span className="required">*</span>
              </label>
              <input
                id="conn-password"
                type="password"
                placeholder="JupyterHub password"
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
            <span>Use Proxy (SOCKS / SSH -D)</span>
          </label>
        </div>

        {/* Proxy Configuration */}
        {showProxy && (
          <div className="proxy-config animate-slide-in">
            <div className="form-group">
              <label className="form-label" htmlFor="proxy-type">
                Proxy Type
              </label>
              <select
                id="proxy-type"
                value={proxyType}
                onChange={(e) =>
                  setProxyType(e.target.value as 'socks5' | 'http')
                }
              >
                <option value="socks5">SOCKS5 (SSH -D)</option>
                <option value="http">HTTP</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group form-group--flex">
                <label className="form-label" htmlFor="proxy-host">
                  Host
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
                  Port
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
            <p className="form-hint">
              For SSH tunnel: <code>ssh -D 1080 user@server</code>
            </p>
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary connect-btn"
          disabled={
            isConnecting ||
            !url.trim() ||
            (authMode === 'tljh' && (!username.trim() || !password))
          }
        >
          {isConnecting ? (
            <>
              <span className="animate-spin">⟳</span> Connecting...
            </>
          ) : (
            'Connect'
          )}
        </button>
      </form>
    </div>
  );
}
