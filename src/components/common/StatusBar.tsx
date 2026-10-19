import { t, localizeStatus } from '../../i18n';
/**
 * StatusBar — Bottom bar showing connection status, active notebook telemetry, and app info.
 */

import { Sparkles, Cpu, Server } from 'lucide-react';
import type { ServerConnection } from '../../types/jupyter';
import './StatusBar.css';

interface StatusBarProps {
  activeServer: ServerConnection | null;
  serverCount: number;
  onToggleAgent: () => void;
  isAgentOpen: boolean;
  kernelStatus?: string;
  activeCellIndex?: number;
}

export function StatusBar({
  activeServer,
  serverCount,
  onToggleAgent,
  isAgentOpen,
  kernelStatus,
  activeCellIndex,
}: StatusBarProps) {
  return (
    <>
      {/* Left side */}
      <div className="statusbar__left">
        {activeServer ? (
          <div className="statusbar__server">
            <span className={`status-dot ${activeServer.status}`} />
            <span className="statusbar__server-name">
              {activeServer.config.name}
            </span>
            {activeServer.server_info && (
              <span className="statusbar__version">
                v{activeServer.server_info.version}
              </span>
            )}
          </div>
        ) : (
          <span className="statusbar__disconnected">
            {t('No server connected')}
          </span>
        )}

        {kernelStatus && (
          <div className="statusbar__telemetry">
            <Cpu size={12} strokeWidth={1.75} />
            <span>
              {t('Kernel')}: {localizeStatus(kernelStatus)}
            </span>
            {typeof activeCellIndex === 'number' && (
              <span className="statusbar__cell-index">
                · {t('Cell {index}', { index: activeCellIndex + 1 })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="statusbar__right">
        {serverCount > 0 && (
          <span className="statusbar__info">
            <Server size={11} strokeWidth={1.75} />
            <span>
              {t(serverCount === 1 ? '{count} server' : '{count} servers', {
                count: serverCount,
              })}
            </span>
          </span>
        )}

        <button
          type="button"
          onClick={onToggleAgent}
          className={`statusbar__agent-btn ${
            isAgentOpen ? 'statusbar__agent-btn--active' : ''
          }`}
          title={t('Toggle ReAct AI Agent Panel')}
        >
          <Sparkles size={12} strokeWidth={1.75} aria-hidden="true" />
          <span>{t('AI Agent')}</span>
        </button>

        <span className="statusbar__brand">LabNexus v0.5</span>
      </div>
    </>
  );
}
