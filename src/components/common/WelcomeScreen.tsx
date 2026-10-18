import { t } from '../../i18n';
/**
 * WelcomeScreen — Displayed in the editor area when no file is open.
 */

import './WelcomeScreen.css';
import { BrandLogo } from './BrandLogo';

export function WelcomeScreen() {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__content animate-fade-in">
        <div className="welcome-screen__logo">
          <BrandLogo size={72} />
        </div>
        <h1 className="welcome-screen__title">LabNexus</h1>
        <p className="welcome-screen__subtitle">
          {t('Remote JupyterLab Client with AI Agent')}
        </p>

        <div className="welcome-screen__actions">
          <div className="welcome-action">
            <span className="welcome-action__icon">🔌</span>
            <div>
              <h3 className="welcome-action__title">{t('Connect to Server')}</h3>
              <p className="welcome-action__desc">
                {t('Open the Explorer panel to connect to a remote Jupyter server')}
              </p>
            </div>
          </div>
          <div className="welcome-action">
            <span className="welcome-action__icon">📓</span>
            <div>
              <h3 className="welcome-action__title">{t('Open Notebook')}</h3>
              <p className="welcome-action__desc">
                {t('Browse and open remote notebooks for editing and execution')}
              </p>
            </div>
          </div>
          <div className="welcome-action">
            <span className="welcome-action__icon">🤖</span>
            <div>
              <h3 className="welcome-action__title">{t('AI Agent')}</h3>
              <p className="welcome-action__desc">
                {t('Use the AI agent to analyze data and automate tasks')}
              </p>
            </div>
          </div>
        </div>

        <div className="welcome-screen__shortcuts">
          <p className="welcome-screen__shortcut-hint">
            {t('Press the sidebar icons to get started')}
          </p>
        </div>
      </div>
    </div>
  );
}
