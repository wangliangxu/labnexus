import { t, localizeStatus } from '../../i18n';
/**
 * TerminalPanel — xterm.js terminal control panel for remote Jupyter terminal sessions.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTerminal } from '../../hooks/useTerminal';

// xterm renders to canvas, so refresh its colors when the root theme changes.
function readTerminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    background: color('--bg-panel'), foreground: color('--text-primary'),
    cursor: color('--text-primary'), cursorAccent: color('--bg-panel'),
    selectionBackground: dark ? '#264f78' : '#bbdefb',
    black: dark ? '#212121' : '#000000', red: dark ? '#ef9a9a' : '#b71c1c',
    green: dark ? '#81c784' : '#1b5e20', yellow: dark ? '#ffb74d' : '#795500',
    blue: dark ? '#64b5f6' : '#1565c0', magenta: dark ? '#ce93d8' : '#7b1fa2',
    cyan: dark ? '#80deea' : '#006064', white: dark ? '#eeeeee' : '#616161',
    brightBlack: dark ? '#9e9e9e' : '#757575', brightRed: dark ? '#ffcdd2' : '#c62828',
    brightGreen: dark ? '#c8e6c9' : '#2e7d32', brightYellow: dark ? '#ffe0b2' : '#8d6e00',
    brightBlue: dark ? '#bbdefb' : '#1976d2', brightMagenta: dark ? '#e1bee7' : '#8e24aa',
    brightCyan: dark ? '#b2ebf2' : '#00838f', brightWhite: dark ? '#ffffff' : '#424242',
  };
}

interface TerminalPanelProps {
  serverId?: string;
  terminalName: string;
  onClose?: () => void;
}

export function TerminalPanel({ serverId, terminalName, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { status, error, connect, sendInput, resize } = useTerminal({
    serverId,
    terminalName,
    onData: (data) => {
      termRef.current?.write(data);
    },
    onExit: () => {
      if (onClose) onClose();
    },
  });

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: readTerminalTheme(),
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTerminalTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    term.onData((data) => {
      sendInput(data);
    });

    // Connect to WebSocket
    connect();

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (term.rows && term.cols) {
          resize(term.rows, term.cols);
        }
      } catch (e) {
        // ignore resize error during unmount
      }
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalName, serverId]);

  return (
    <div className="flex flex-col h-full w-full bg-dark-surface text-gray-200">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-dark-border bg-dark-surface">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-2 py-0.5 bg-dark-bg text-brand-primary rounded">
            {t('terminal:')} {terminalName}
          </span>
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'connected'
                ? 'bg-emerald-500 animate-pulse'
                : status === 'connecting'
                ? 'bg-amber-500'
                : 'bg-red-500'
            }`}
            title={t('Status: {status}', { status: localizeStatus(status) })}
          />
          <span className="text-xs text-gray-400 capitalize">{localizeStatus(status)}</span>
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-dark-bg text-gray-400 hover:text-gray-200 rounded transition-colors text-xs"
              title={t('Close Terminal')}
            >
              {t('✕ Close')}
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={connect} className="underline hover:text-red-300">
            {t('Retry')}
          </button>
        </div>
      )}

      {/* Terminal Canvas Container */}
      <div ref={containerRef} className="flex-1 w-full p-2 overflow-hidden" />
    </div>
  );
}
