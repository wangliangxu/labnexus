import { t } from '../../i18n';
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { jupyterDetectLocal } from '../../services/tauriIpc';
import type { LocalJupyterInstallation } from '../../types/jupyter';
import './ConnectionPanel.css';

interface Props {
  isConnecting: boolean;
  connected: boolean;
  onStart: () => Promise<void>;
}

export function LocalJupyterPanel({ isConnecting, connected, onStart }: Props) {
  const [installation, setInstallation] = useState<LocalJupyterInstallation | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const desktop = isTauri();

  const detect = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setInstallation(await jupyterDetectLocal());
    } catch (e: unknown) {
      setError(typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (desktop) void detect();
    else setChecking(false);
  }, [desktop, detect]);

  return (
    <section className="local-jupyter" aria-label={t('Local Jupyter')}>
      <div className="local-jupyter__header">
        <h3 className="panel-header__title">{t('Local Jupyter')}</h3>
        <button className="btn btn-icon btn-ghost" type="button"
          aria-label={t('Detect local Jupyter again')} title={t('Detect again')}
          disabled={!desktop || checking || isConnecting} onClick={() => void detect()}>↻</button>
      </div>
      <p className="form-hint" role="status">
        {!desktop ? t('Start the local server in the desktop application.') : checking ? t('Checking local installation…') : error
          ? t('Detection failed: {error}', { error }) : installation
          ? `${installation.name} ${installation.version}` : t('Jupyter or JupyterLab was not detected.')}
      </p>
      {installation && <p className="form-hint local-jupyter__path" title={installation.executable}>{installation.executable}</p>}
      {desktop && !checking && !installation && !error && (
        <p className="form-hint">{t('Install, then detect again:')}<br /><code>python -m pip install jupyterlab</code></p>
      )}
      <button type="button" className="btn btn-primary connect-btn"
        disabled={!desktop || checking || !installation || isConnecting || connected}
        onClick={() => void onStart()}>
        {connected ? t('Local server connected') : isConnecting ? t('Connecting...') : t('Start and connect')}
      </button>
      <p className="form-hint">{t('Random available port · Home directory · Stops on disconnect')}</p>
    </section>
  );
}
