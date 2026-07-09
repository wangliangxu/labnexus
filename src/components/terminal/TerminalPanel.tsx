/**
 * TerminalPanel — xterm.js terminal control panel for remote Jupyter terminal sessions.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTerminal } from '../../hooks/useTerminal';

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
      theme: {
        background: '#09090b', // zinc-950
        foreground: '#e4e4e7', // zinc-200
        cursor: '#38bdf8', // sky-400
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#18181b',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#ec4899',
        cyan: '#06b6d4',
        white: '#f4f4f5',
      },
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

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
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalName, serverId]);

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950 text-zinc-200">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-2 py-0.5 bg-zinc-800 text-sky-400 rounded">
            terminal: {terminalName}
          </span>
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'connected'
                ? 'bg-emerald-500 animate-pulse'
                : status === 'connecting'
                ? 'bg-amber-500'
                : 'bg-red-500'
            }`}
            title={`Status: ${status}`}
          />
          <span className="text-xs text-zinc-400 capitalize">{status}</span>
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded transition-colors text-xs"
              title="Close Terminal"
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={connect} className="underline hover:text-red-300">
            Retry
          </button>
        </div>
      )}

      {/* Terminal Canvas Container */}
      <div ref={containerRef} className="flex-1 w-full p-2 overflow-hidden" />
    </div>
  );
}
