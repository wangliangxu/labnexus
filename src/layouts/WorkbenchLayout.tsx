/**
 * WorkbenchLayout — IDE-style main layout with sidebar, panel, and editor area.
 */

import { useState, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TableOfContents } from 'lucide-react';
import { BrandLogo } from '../components/common/BrandLogo';
import './WorkbenchLayout.css';

export type PanelId = 'explorer' | 'terminal' | 'toc' | 'agent' | 'settings' | null;

interface WorkbenchLayoutProps {
  sidebar?: ReactNode;
  panel: ReactNode;
  editor: ReactNode;
  statusBar: ReactNode;
  activePanel?: PanelId;
  onPanelChange?: (panel: PanelId) => void;
  assistant?: ReactNode;
  assistantWidth?: number;
  assistantFullscreen?: boolean;
  assistantOpen?: boolean;
}

export function WorkbenchLayout({
  sidebar: _sidebar,
  panel,
  editor,
  statusBar,
  activePanel: controlledPanel,
  onPanelChange,
  assistant,
  assistantWidth = 500,
  assistantFullscreen = false,
  assistantOpen = false,
}: WorkbenchLayoutProps) {
  const [internalPanel, setInternalPanel] = useState<PanelId>('explorer');
  const currentPanel = controlledPanel !== undefined ? controlledPanel : internalPanel;

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem('labnexus:panel-width');
    return saved ? parseInt(saved, 10) : 260;
  });
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, 180), 800);
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setPanelWidth((currentWidth) => {
        localStorage.setItem('labnexus:panel-width', currentWidth.toString());
        return currentWidth;
      });
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handlePanelClick = (id: PanelId) => {
    const nextPanel = currentPanel === id ? null : id;
    if (onPanelChange) {
      onPanelChange(nextPanel);
    } else {
      setInternalPanel(nextPanel);
    }
  };

  const handleTitlebarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isTauri()) return;
    if ((event.target as HTMLElement).closest('[data-no-drag]')) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <div
      className={`workbench ${assistant ? 'workbench--with-assistant' : ''} ${assistantFullscreen ? 'workbench--assistant-fullscreen' : ''}`}
      style={{
        ...(currentPanel ? { '--panel-width': `${panelWidth}px` } : {}),
        '--assistant-width': `${assistantWidth}px`,
      } as React.CSSProperties}
    >
      {/* Title Bar (replaces Activity Bar) */}
      <div
        className="workbench__titlebar"
        onPointerDown={handleTitlebarPointerDown}
      >
        <div className="titlebar__left">
          <button
            data-no-drag
            className={`titlebar__item ${currentPanel === 'explorer' ? 'active' : ''}`}
            onClick={() => handlePanelClick('explorer')}
            title="Explorer"
            aria-label="Explorer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
            </svg>
          </button>
          <button
            data-no-drag
            className={`titlebar__item ${currentPanel === 'terminal' ? 'active' : ''}`}
            onClick={() => handlePanelClick('terminal')}
            title="Remote Terminals"
            aria-label="Remote Terminals"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>
          <button
            data-no-drag
            className={`titlebar__item ${currentPanel === 'toc' ? 'active' : ''}`}
            onClick={() => handlePanelClick('toc')}
            title="Table of Contents"
            aria-label="Table of Contents"
          >
            <TableOfContents size={18} strokeWidth={1.6} />
          </button>
        </div>
        <div className="titlebar__center">
          <div className="titlebar__brand" aria-hidden="true">
            <BrandLogo size={18} />
            <span>LabNexus</span>
          </div>
        </div>
        <div className="titlebar__right">
          <button
            data-no-drag
            className={`titlebar__item ${assistantOpen ? 'active' : ''}`}
            onClick={() => handlePanelClick('agent')}
            title="AI Agent"
            aria-label="AI Agent"
          >
            <span className="titlebar__agent-icon">⚡️</span>
          </button>
          <button
            data-no-drag
            className={`titlebar__item ${currentPanel === 'settings' ? 'active' : ''}`}
            onClick={() => handlePanelClick('settings')}
            title="Settings"
            aria-label="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Side Panel */}
      {currentPanel && (
        <div className="workbench__panel animate-slide-in">
          <div className="workbench__panel-content">
            {panel}
          </div>
          <div
            className={`workbench__resizer ${isResizing ? 'resizing' : ''}`}
            onMouseDown={handleMouseDown}
            title="Drag to resize sidebar"
          />
        </div>
      )}

      {/* Editor Area */}
      <div className="workbench__editor">
        {editor}
      </div>

      {assistant && <div className="workbench__assistant">{assistant}</div>}

      {/* Status Bar */}
      <div className="workbench__statusbar">
        {statusBar}
      </div>
    </div>
  );
}
