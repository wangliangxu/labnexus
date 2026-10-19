import { t } from '../../i18n';
/**
 * WelcomeScreen — Displayed in the editor area when no file is open.
 */

import { Server, BookOpen, Sparkles, ChevronRight } from 'lucide-react';
import './WelcomeScreen.css';
import { BrandLogo } from './BrandLogo';

interface WelcomeScreenProps {
  onConnectServer?: () => void;
  onOpenExplorer?: () => void;
  onOpenAgent?: () => void;
}

export function WelcomeScreen({
  onConnectServer,
  onOpenExplorer,
  onOpenAgent,
}: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__content animate-fade-in">
        <div className="welcome-screen__logo">
          <BrandLogo size={68} />
        </div>
        <h1 className="welcome-screen__title">LabNexus</h1>
        <p className="welcome-screen__subtitle">
          {t('Remote JupyterLab Client with AI Agent')}
        </p>

        <div className="welcome-screen__actions">
          <div
            className="welcome-action"
            role={onConnectServer ? 'button' : undefined}
            tabIndex={onConnectServer ? 0 : undefined}
            onClick={onConnectServer}
            onKeyDown={(e) => {
              if (onConnectServer && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onConnectServer();
              }
            }}
          >
            <span className="welcome-action__icon">
              <Server size={18} strokeWidth={1.8} />
            </span>
            <div className="welcome-action__body">
              <h3 className="welcome-action__title">{t('Connect to Server')}</h3>
              <p className="welcome-action__desc">
                {t('Open the Explorer panel to connect to a remote Jupyter server')}
              </p>
            </div>
            {onConnectServer && (
              <ChevronRight size={15} className="welcome-action__arrow" />
            )}
          </div>

          <div
            className="welcome-action"
            role={onOpenExplorer ? 'button' : undefined}
            tabIndex={onOpenExplorer ? 0 : undefined}
            onClick={onOpenExplorer}
            onKeyDown={(e) => {
              if (onOpenExplorer && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onOpenExplorer();
              }
            }}
          >
            <span className="welcome-action__icon">
              <BookOpen size={18} strokeWidth={1.8} />
            </span>
            <div className="welcome-action__body">
              <h3 className="welcome-action__title">{t('Open Notebook')}</h3>
              <p className="welcome-action__desc">
                {t('Browse and open remote notebooks for editing and execution')}
              </p>
            </div>
            {onOpenExplorer && (
              <ChevronRight size={15} className="welcome-action__arrow" />
            )}
          </div>

          <div
            className="welcome-action"
            role={onOpenAgent ? 'button' : undefined}
            tabIndex={onOpenAgent ? 0 : undefined}
            onClick={onOpenAgent}
            onKeyDown={(e) => {
              if (onOpenAgent && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onOpenAgent();
              }
            }}
          >
            <span className="welcome-action__icon">
              <Sparkles size={18} strokeWidth={1.8} />
            </span>
            <div className="welcome-action__body">
              <h3 className="welcome-action__title">{t('AI Agent')}</h3>
              <p className="welcome-action__desc">
                {t('Use the AI agent to analyze data and automate tasks')}
              </p>
            </div>
            {onOpenAgent && (
              <ChevronRight size={15} className="welcome-action__arrow" />
            )}
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
