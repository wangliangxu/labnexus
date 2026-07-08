import React from 'react';
import {
  Save,
  Plus,
  Play,
  Square,
  RotateCcw,
  Loader2,
  Check,
  AlertCircle,
  WifiOff,
} from 'lucide-react';
import type { CellType, KernelStatus } from '../../types/jupyter';

interface NotebookToolbarProps {
  notebookName: string;
  kernelName: string;
  status: KernelStatus;
  isDirty: boolean;
  isSaving: boolean;
  isConnecting: boolean;
  canRun: boolean;
  activeCellType: CellType;
  onSave: () => void;
  onAddCode: () => void;
  onAddMarkdown: () => void;
  onRunSelected: () => void;
  onRunAll: () => void;
  onInterrupt: () => void;
  onRestart: () => void;
  onConnect: () => void;
  onActiveCellTypeChange: (type: CellType) => void;
}

/* ── Toolbar button class tokens ─────────────────────────────────── */
const tbBtn =
  'inline-flex items-center justify-center gap-1 min-h-[26px] px-2 ' +
  'border border-transparent rounded-sm bg-transparent ' +
  'text-nb-text-secondary text-xs leading-none whitespace-nowrap ' +
  'hover:border-nb-btn-hover-border hover:bg-nb-btn-hover ' +
  'disabled:opacity-45 disabled:cursor-default transition-colors';

const tbBtnPrimary =
  'inline-flex items-center justify-center gap-1 min-h-[26px] px-2 ' +
  'border border-nb-btn-primary rounded-sm bg-nb-btn-primary text-white ' +
  'text-xs leading-none whitespace-nowrap ' +
  'hover:border-nb-btn-primary-hover hover:bg-nb-btn-primary-hover ' +
  'disabled:opacity-45 disabled:cursor-default transition-colors';

const badgeBase =
  'inline-flex items-center gap-1 min-h-6 max-w-[220px] px-2 ' +
  'border border-nb-cell-border rounded-full bg-nb-cell ' +
  'text-xs leading-none whitespace-nowrap';

export const NotebookToolbar: React.FC<NotebookToolbarProps> = ({
  notebookName,
  kernelName,
  status,
  isDirty,
  isSaving,
  isConnecting,
  canRun,
  activeCellType,
  onSave,
  onAddCode,
  onAddMarkdown,
  onRunSelected,
  onRunAll,
  onInterrupt,
  onRestart,
  onConnect,
  onActiveCellTypeChange,
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case 'idle':
        return (
          <span className={`${badgeBase} text-nb-status-idle`}>
            <span className="w-[7px] h-[7px] rounded-full bg-current" />
            Idle
          </span>
        );
      case 'busy':
        return (
          <span className={`${badgeBase} text-nb-status-busy`}>
            <Loader2 size={13} className="animate-spin" />
            Busy
          </span>
        );
      case 'starting':
      case 'restarting':
        return (
          <span className={`${badgeBase} text-nb-status-busy`}>
            <Loader2 size={13} className="animate-spin" />
            {status === 'starting' ? 'Starting...' : 'Restarting...'}
          </span>
        );
      case 'dead':
      case 'error':
        return (
          <span className={`${badgeBase} text-nb-status-error`}>
            <AlertCircle size={13} />
            {status === 'dead' ? 'Dead' : 'Error'}
          </span>
        );
      case 'disconnected':
      default:
        return (
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className={`${badgeBase} text-nb-status-disconnected cursor-pointer`}
          >
            {isConnecting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <WifiOff size={13} />
            )}
            <span>{isConnecting ? 'Connecting...' : 'Disconnected (Connect)'}</span>
          </button>
        );
    }
  };

  return (
    <div className="sticky top-0 z-20 flex items-center min-h-9 gap-1.5 px-2.5 py-1 border-b border-nb-toolbar-border bg-nb-toolbar shadow-sm max-[760px]:flex-wrap">
      {/* Save + Add cells */}
      <div className="inline-flex items-center gap-[3px] min-w-0">
        <button
          onClick={onSave}
          disabled={!isDirty || isSaving}
          title="Save Notebook (Ctrl+S / Cmd+S)"
          className={tbBtn}
        >
          {isSaving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : !isDirty ? (
            <Check size={15} />
          ) : (
            <Save size={15} />
          )}
        </button>

        <span className="w-px h-[18px] mx-[3px] bg-nb-toolbar-border" />

        <button onClick={onAddCode} title="Add Code Cell Below" className={tbBtn}>
          <Plus size={15} />
          <span>Code</span>
        </button>

        <button onClick={onAddMarkdown} title="Add Markdown Cell Below" className={tbBtn}>
          <Plus size={15} />
          <span>Markdown</span>
        </button>
      </div>

      {/* Cell type selector */}
      <div className="inline-flex items-center gap-[3px] min-w-0">
        <select
          className="h-[26px] min-w-[126px] pl-2 pr-6 border border-nb-cell-border rounded-sm bg-nb-cell text-nb-text text-xs"
          value={activeCellType}
          title="Cell Type"
          onChange={(event) =>
            onActiveCellTypeChange(event.target.value as CellType)
          }
        >
          <option value="code">Code</option>
          <option value="markdown">Markdown</option>
          <option value="raw">Raw</option>
        </select>
      </div>

      {/* Execution controls */}
      <div className="inline-flex items-center gap-[3px] min-w-0">
        <button
          onClick={onRunSelected}
          disabled={!canRun}
          title="Run Selected Cell (Ctrl/Cmd+Enter)"
          className={tbBtnPrimary}
        >
          <Play size={15} fill="currentColor" />
          <span>Run</span>
        </button>

        <button
          onClick={onInterrupt}
          disabled={status !== 'busy'}
          title="Interrupt Kernel"
          className={tbBtn}
        >
          <Square size={14} fill="currentColor" />
        </button>

        <button
          onClick={onRestart}
          title="Restart Kernel"
          className={tbBtn}
        >
          <RotateCcw size={15} />
        </button>

        <button
          onClick={onRunAll}
          disabled={!canRun}
          title="Run All Cells"
          className={tbBtn}
        >
          <Play size={15} fill="currentColor" />
          <span>Run All</span>
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-auto min-w-4" />

      {/* Notebook identity */}
      <div
        className="inline-flex items-center min-w-0 max-w-[min(34vw,420px)] gap-1.5 text-nb-text-secondary text-xs max-[760px]:max-w-full"
        title={notebookName}
      >
        <span className="truncate">{notebookName}</span>
        {isDirty && (
          <span
            className="w-[7px] h-[7px] flex-none rounded-full bg-nb-dirty"
            title="Unsaved changes"
          />
        )}
      </div>

      {/* Kernel chip */}
      <div
        className={`${badgeBase} overflow-hidden text-ellipsis font-mono text-nb-text-secondary`}
        title={kernelName || 'Python 3'}
      >
        {kernelName || 'Python 3'}
      </div>

      {/* Status badge */}
      {getStatusBadge()}
    </div>
  );
};
