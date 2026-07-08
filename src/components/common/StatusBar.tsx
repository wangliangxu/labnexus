/**
 * StatusBar — Bottom bar showing connection status and app info.
 */

import type { ServerConnection } from '../../types/jupyter';
import './StatusBar.css';

interface StatusBarProps {
  activeServer: ServerConnection | null;
  serverCount: number;
  onToggleAgent: () => void;
  isAgentOpen: boolean;
}

export function StatusBar({
  activeServer,
  serverCount,
  onToggleAgent,
  isAgentOpen,
}: StatusBarProps) {
  return (
    <>
      {/* Left side */}
      <div className="statusbar__left">
        {activeServer ? (
          <div className="statusbar__server">
            <span
              className={`status-dot ${activeServer.status}`}
            />
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
          <span className="statusbar__disconnected">No server connected</span>
        )}
      </div>

      {/* Right side */}
      <div className="statusbar__right flex items-center gap-3">
        <button
          onClick={onToggleAgent}
          className={`px-2 py-0.5 rounded text-xs flex items-center gap-1 font-semibold transition-all shadow-sm ${
            isAgentOpen
              ? 'bg-brand-primary text-white shadow-brand-primary/30'
              : 'bg-dark-surface hover:bg-dark-border text-gray-300 border border-dark-border'
          }`}
          title="Toggle ReAct AI Assistant Panel"
        >
          <span>🤖</span>
          <span>AI Assistant</span>
        </button>

        {serverCount > 0 && (
          <span className="statusbar__info">
            {serverCount} server{serverCount !== 1 ? 's' : ''}
          </span>
        )}
        <span className="statusbar__brand">LabNexus</span>
      </div>
    </>
  );
}
