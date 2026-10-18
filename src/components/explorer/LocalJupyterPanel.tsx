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
    <section className="local-jupyter" aria-label="本地 Jupyter">
      <div className="local-jupyter__header">
        <h3 className="panel-header__title">本地 Jupyter</h3>
        <button className="btn btn-icon btn-ghost" type="button"
          aria-label="重新检测本地 Jupyter" title="重新检测"
          disabled={!desktop || checking || isConnecting} onClick={() => void detect()}>↻</button>
      </div>
      <p className="form-hint" role="status">
        {!desktop ? '请在桌面应用中启动本地服务。' : checking ? '正在检测本地安装…' : error
          ? `检测失败：${error}` : installation
          ? `${installation.name} ${installation.version}` : '未检测到 Jupyter 或 JupyterLab。'}
      </p>
      {installation && <p className="form-hint local-jupyter__path" title={installation.executable}>{installation.executable}</p>}
      {desktop && !checking && !installation && !error && (
        <p className="form-hint">安装后重新检测：<br /><code>python -m pip install jupyterlab</code></p>
      )}
      <button type="button" className="btn btn-primary connect-btn"
        disabled={!desktop || checking || !installation || isConnecting || connected}
        onClick={() => void onStart()}>
        {connected ? '本地服务已连接' : isConnecting ? '正在连接…' : '启动并连接'}
      </button>
      <p className="form-hint">随机空闲端口 · 用户主目录 · 断开时停止</p>
    </section>
  );
}
