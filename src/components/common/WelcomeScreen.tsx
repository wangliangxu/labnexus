/**
 * WelcomeScreen — Displayed in the editor area when no file is open.
 */

import './WelcomeScreen.css';

export function WelcomeScreen() {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__content animate-fade-in">
        <div className="welcome-screen__logo">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="16" fill="url(#gradient)" />
            <path
              d="M20 44V20L32 28L44 20V44L32 36L20 44Z"
              fill="white"
              fillOpacity="0.9"
            />
            <defs>
              <linearGradient id="gradient" x1="0" y1="0" x2="64" y2="64">
                <stop stopColor="#6366f1" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h1 className="welcome-screen__title">LabNexus</h1>
        <p className="welcome-screen__subtitle">
          Remote JupyterLab Client with AI Agent
        </p>

        <div className="welcome-screen__actions">
          <div className="welcome-action">
            <span className="welcome-action__icon">🔌</span>
            <div>
              <h3 className="welcome-action__title">Connect to Server</h3>
              <p className="welcome-action__desc">
                Open the Explorer panel to connect to a remote Jupyter server
              </p>
            </div>
          </div>
          <div className="welcome-action">
            <span className="welcome-action__icon">📓</span>
            <div>
              <h3 className="welcome-action__title">Open Notebook</h3>
              <p className="welcome-action__desc">
                Browse and open remote notebooks for editing and execution
              </p>
            </div>
          </div>
          <div className="welcome-action">
            <span className="welcome-action__icon">🤖</span>
            <div>
              <h3 className="welcome-action__title">AI Agent</h3>
              <p className="welcome-action__desc">
                Use the AI agent to analyze data and automate tasks
              </p>
            </div>
          </div>
        </div>

        <div className="welcome-screen__shortcuts">
          <p className="welcome-screen__shortcut-hint">
            Press the sidebar icons to get started
          </p>
        </div>
      </div>
    </div>
  );
}
