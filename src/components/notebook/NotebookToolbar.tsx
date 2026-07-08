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
          <span className="notebook-status-badge notebook-status-badge--idle">
            <span className="notebook-status-badge__dot" />
            Idle
          </span>
        );
      case 'busy':
        return (
          <span className="notebook-status-badge notebook-status-badge--busy">
            <Loader2 size={13} className="animate-spin" />
            Busy
          </span>
        );
      case 'starting':
      case 'restarting':
        return (
          <span className="notebook-status-badge notebook-status-badge--starting">
            <Loader2 size={13} className="animate-spin" />
            {status === 'starting' ? 'Starting...' : 'Restarting...'}
          </span>
        );
      case 'dead':
      case 'error':
        return (
          <span className="notebook-status-badge notebook-status-badge--error">
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
            className="notebook-status-badge notebook-status-badge--disconnected"
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
    <div className="notebook-toolbar">
      <div className="notebook-toolbar__group">
        <button
          onClick={onSave}
          disabled={!isDirty || isSaving}
          title="Save Notebook (Ctrl+S / Cmd+S)"
          className="notebook-toolbar__button"
        >
          {isSaving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : !isDirty ? (
            <Check size={15} />
          ) : (
            <Save size={15} />
          )}
        </button>

        <span className="notebook-toolbar__divider" />

        <button
          onClick={onAddCode}
          title="Add Code Cell Below"
          className="notebook-toolbar__button"
        >
          <Plus size={15} />
          <span>Code</span>
        </button>

        <button
          onClick={onAddMarkdown}
          title="Add Markdown Cell Below"
          className="notebook-toolbar__button"
        >
          <Plus size={15} />
          <span>Markdown</span>
        </button>
      </div>

      <div className="notebook-toolbar__group">
        <select
          className="notebook-toolbar__select"
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

      <div className="notebook-toolbar__group">
        <button
          onClick={onRunSelected}
          disabled={!canRun}
          title="Run Selected Cell (Ctrl/Cmd+Enter)"
          className="notebook-toolbar__button notebook-toolbar__button--primary"
        >
          <Play size={15} fill="currentColor" />
          <span>Run</span>
        </button>

        <button
          onClick={onInterrupt}
          disabled={status !== 'busy'}
          title="Interrupt Kernel"
          className="notebook-toolbar__button"
        >
          <Square size={14} fill="currentColor" />
        </button>

        <button
          onClick={onRestart}
          title="Restart Kernel"
          className="notebook-toolbar__button"
        >
          <RotateCcw size={15} />
        </button>

        <button
          onClick={onRunAll}
          disabled={!canRun}
          title="Run All Cells"
          className="notebook-toolbar__button"
        >
          <Play size={15} fill="currentColor" />
          <span>Run All</span>
        </button>
      </div>

      <div className="notebook-toolbar__spacer" />

      <div className="notebook-toolbar__identity" title={notebookName}>
        <span className="notebook-toolbar__name">{notebookName}</span>
        {isDirty && <span className="notebook-toolbar__dirty" title="Unsaved changes" />}
      </div>

      <div className="notebook-kernel-chip" title={kernelName || 'Python 3'}>
        {kernelName || 'Python 3'}
      </div>

      {getStatusBadge()}
    </div>
  );
};
