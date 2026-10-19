import { t } from '../../i18n';
/**
 * TerminalSelector — Panel to list active remote terminals or create a new one.
 */

import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Plus,
  Terminal,
  AlertTriangle,
  Trash2,
  Loader2,
} from 'lucide-react';
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

export function TerminalSelector({
  serverId,
  onSelectTerminal,
  onClose: _onClose,
}: TerminalSelectorProps) {
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
      setError(
        typeof err === 'string'
          ? err
          : err.message || t('Failed to fetch terminals')
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTerminals();

    let unlistenExited: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ server_id?: string; terminal_name: string }>(
        'jupyter:terminal_exited',
        () => {
          void fetchTerminals();
        }
      ).then((unlisten) => {
        unlistenExited = unlisten;
      });
    });

    return () => {
      if (unlistenExited) unlistenExited();
    };
  }, [serverId]);

  const handleCreate = async () => {
    try {
      setLoading(true);
      const newTerm = await jupyterCreateTerminal(serverId);
      onSelectTerminal(newTerm.name);
    } catch (err: any) {
      setError(
        typeof err === 'string'
          ? err
          : err.message || t('Failed to create terminal')
      );
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    try {
      await jupyterDeleteTerminal(name, serverId);
      await fetchTerminals();
    } catch (err: any) {
      setError(
        typeof err === 'string'
          ? err
          : err.message || t('Failed to delete terminal')
      );
    }
  };

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Header */}
      <div className="panel-header">
        <h3 className="panel-header__title">{t('Remote Terminals')}</h3>
        <div className="panel-header__actions">
          <button
            type="button"
            onClick={() => void fetchTerminals()}
            disabled={loading}
            className="btn btn-icon btn-ghost"
            title={t('Refresh List')}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading}
            className="btn btn-sm btn-primary inline-flex items-center gap-1"
            title={t('Create New Terminal')}
          >
            <Plus size={12} strokeWidth={2} />
            <span>{t('New')}</span>
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div
          className="px-3 py-2 text-xs inline-flex items-center gap-1.5"
          style={{
            background: 'var(--color-error-subtle)',
            borderBottom: '1px solid var(--border-subtle)',
            color: 'var(--color-error)',
          }}
        >
          <AlertTriangle size={13} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Terminal List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading && terminals.length === 0 ? (
          <div
            className="p-4 text-center text-xs inline-flex items-center justify-center gap-2 w-full"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <Loader2 size={14} className="animate-spin" />
            <span>{t('Loading terminal sessions...')}</span>
          </div>
        ) : terminals.length === 0 ? (
          <div
            className="p-6 text-center flex flex-col items-center gap-2.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{
                background: 'var(--color-primary-subtle)',
                color: 'var(--color-primary)',
              }}
            >
              <Terminal size={18} strokeWidth={1.75} />
            </div>
            <p className="text-xs">{t('No active terminal sessions.')}</p>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="btn btn-sm btn-ghost mt-1"
              style={{
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              {t('+ Launch First Terminal')}
            </button>
          </div>
        ) : (
          terminals.map((term) => (
            <div
              key={term.name}
              onClick={() => onSelectTerminal(term.name)}
              className="group flex items-center justify-between p-2 rounded-md cursor-pointer transition-all"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Terminal
                  size={15}
                  strokeWidth={1.8}
                  className="shrink-0"
                  style={{ color: 'var(--color-success)' }}
                />
                <div className="flex flex-col min-w-0">
                  <span
                    className="text-xs font-mono font-medium truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {t('terminal:')} {term.name}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {t('Active bash/zsh session')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => void handleDelete(e, term.name)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-xs transition-all cursor-pointer"
                style={{ color: 'var(--text-tertiary)' }}
                title={t('Kill Terminal Session')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
