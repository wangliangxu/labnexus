/**
 * TerminalSelector — Modal/Panel to list active remote terminals or create a new one.
 */

import { useState, useEffect } from 'react';
import type { TerminalInfo } from '../../types/jupyter';
import {
  jupyterListTerminals,
  jupyterCreateTerminal,
  jupyterDeleteTerminal,
} from '../../services/tauriIpc';

interface TerminalSelectorProps {
  serverId?: string;
  onSelectTerminal: (name: string) => void;
  onClose?: () => void;
}

export function TerminalSelector({ serverId, onSelectTerminal, onClose: _onClose }: TerminalSelectorProps) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTerminals = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await jupyterListTerminals(serverId);
      setTerminals(list);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to fetch terminals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTerminals();
  }, [serverId]);

  const handleCreate = async () => {
    try {
      setLoading(true);
      const newTerm = await jupyterCreateTerminal(serverId);
      onSelectTerminal(newTerm.name);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to create terminal');
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    try {
      await jupyterDeleteTerminal(name, serverId);
      await fetchTerminals();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Failed to delete terminal');
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-r border-zinc-800 text-zinc-200 select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-950/50">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Remote Terminals</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchTerminals}
            disabled={loading}
            className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded transition-colors text-xs"
            title="Refresh List"
          >
            ↻
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium transition-colors flex items-center gap-1 shadow-sm"
            title="Create New Terminal"
          >
            <span>+</span> New
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs">
          ⚠️ {error}
        </div>
      )}

      {/* Terminal List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && terminals.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">Loading terminal sessions...</div>
        ) : terminals.length === 0 ? (
          <div className="p-6 text-center flex flex-col items-center gap-2 text-zinc-500">
            <span className="text-2xl">💻</span>
            <p className="text-xs">No active terminal sessions.</p>
            <button
              onClick={handleCreate}
              className="mt-1 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-medium transition-colors"
            >
              + Launch First Terminal
            </button>
          </div>
        ) : (
          terminals.map((term) => (
            <div
              key={term.name}
              onClick={() => onSelectTerminal(term.name)}
              className="group flex items-center justify-between p-2 rounded-lg bg-zinc-800/40 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 cursor-pointer transition-all"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-emerald-400 font-mono text-sm">$&gt;</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-mono font-medium text-zinc-200 truncate">
                    terminal: {term.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">Active bash/zsh session</span>
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(e, term.name)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded transition-all text-xs"
                title="Kill Terminal Session"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
