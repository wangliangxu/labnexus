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

/* ── Inline style helpers (avoid global CSS override issues) ──────── */
const tbBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  minHeight: '26px',
  padding: '0 8px',
  border: '1px solid transparent',
  borderRadius: '2px',
  background: 'transparent',
  color: 'var(--color-nb-text-secondary)',
  fontSize: '12px',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: 'all 150ms ease',
};

const tbBtnPrimaryStyle: React.CSSProperties = {
  ...tbBtnStyle,
  background: 'var(--color-nb-btn-primary)',
  borderColor: 'var(--color-nb-btn-primary)',
  color: '#ffffff',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  minHeight: '24px',
  maxWidth: '220px',
  padding: '0 8px',
  border: '1px solid var(--color-nb-cell-border)',
  borderRadius: '9999px',
  background: 'var(--color-nb-cell)',
  fontSize: '12px',
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

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
          <span style={{ ...badgeStyle, color: 'var(--color-nb-status-idle)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
            Idle
          </span>
        );
      case 'busy':
        return (
          <span style={{ ...badgeStyle, color: 'var(--color-nb-status-busy)' }}>
            <Loader2 size={13} className="animate-spin" />
            Busy
          </span>
        );
      case 'starting':
      case 'restarting':
        return (
          <span style={{ ...badgeStyle, color: 'var(--color-nb-status-busy)' }}>
            <Loader2 size={13} className="animate-spin" />
            {status === 'starting' ? 'Starting...' : 'Restarting...'}
          </span>
        );
      case 'dead':
      case 'error':
        return (
          <span style={{ ...badgeStyle, color: 'var(--color-nb-status-error)' }}>
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
            style={{ ...badgeStyle, color: 'var(--color-nb-status-disconnected)', cursor: 'pointer' }}
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
    <div
      className="sticky top-0 z-20 max-[760px]:flex-wrap"
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: '36px',
        gap: '6px',
        padding: '4px 10px',
        borderBottom: '1px solid var(--color-nb-toolbar-border)',
        background: 'var(--color-nb-toolbar)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
      }}
    >
      {/* Save + Add cells */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', minWidth: 0 }}>
        <button
          onClick={onSave}
          disabled={!isDirty || isSaving}
          title="Save Notebook (Ctrl+S / Cmd+S)"
          style={{ ...tbBtnStyle, opacity: (!isDirty || isSaving) ? 0.45 : 1 }}
        >
          {isSaving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : !isDirty ? (
            <Check size={15} />
          ) : (
            <Save size={15} />
          )}
        </button>

        <span style={{
          width: 1, height: 18, margin: '0 3px',
          background: 'var(--color-nb-toolbar-border)',
        }} />

        <button onClick={onAddCode} title="Add Code Cell Below" style={tbBtnStyle}>
          <Plus size={15} />
          <span>Code</span>
        </button>

        <button onClick={onAddMarkdown} title="Add Markdown Cell Below" style={tbBtnStyle}>
          <Plus size={15} />
          <span>Markdown</span>
        </button>
      </div>

      {/* Cell type selector */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', minWidth: 0 }}>
        <select
          style={{
            height: '26px',
            minWidth: '126px',
            paddingLeft: '8px',
            paddingRight: '24px',
            borderRadius: '2px',
            fontSize: '12px',
            background: 'var(--color-nb-cell)',
            color: 'var(--color-nb-text)',
            border: '1px solid var(--color-nb-cell-border)',
            colorScheme: 'auto',
          }}
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
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', minWidth: 0 }}>
        <button
          onClick={onRunSelected}
          disabled={!canRun}
          title="Run Selected Cell (Ctrl/Cmd+Enter)"
          style={{ ...tbBtnPrimaryStyle, opacity: !canRun ? 0.45 : 1 }}
        >
          <Play size={15} fill="currentColor" />
          <span>Run</span>
        </button>

        <button
          onClick={onInterrupt}
          disabled={status !== 'busy'}
          title="Interrupt Kernel"
          style={{ ...tbBtnStyle, opacity: status !== 'busy' ? 0.45 : 1 }}
        >
          <Square size={14} fill="currentColor" />
        </button>

        <button
          onClick={onRestart}
          title="Restart Kernel"
          style={tbBtnStyle}
        >
          <RotateCcw size={15} />
        </button>

        <button
          onClick={onRunAll}
          disabled={!canRun}
          title="Run All Cells"
          style={{ ...tbBtnStyle, opacity: !canRun ? 0.45 : 1 }}
        >
          <Play size={15} fill="currentColor" />
          <span>Run All</span>
        </button>
      </div>

      {/* Spacer */}
      <div style={{ flex: '1 1 auto', minWidth: '16px' }} />

      {/* Notebook identity */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minWidth: 0,
          maxWidth: 'min(34vw, 420px)',
          gap: '6px',
          color: 'var(--color-nb-text-secondary)',
          fontSize: '12px',
        }}
        title={notebookName}
      >
        <span className="truncate">{notebookName}</span>
        {isDirty && (
          <span
            style={{
              width: 7, height: 7, flexShrink: 0, borderRadius: '50%',
              background: 'var(--color-nb-dirty)',
            }}
            title="Unsaved changes"
          />
        )}
      </div>

      {/* Kernel chip */}
      <div
        style={{
          ...badgeStyle,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-nb-text-secondary)',
        }}
        title={kernelName || 'Python 3'}
      >
        {kernelName || 'Python 3'}
      </div>

      {/* Status badge */}
      {getStatusBadge()}
    </div>
  );
};
