import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertTriangle, FileCode } from 'lucide-react';
import type { Cell, CellType, CellOutput } from '../../types/jupyter';
import type { AgentChatContext } from '../../types/agent';
import { jupyterGetContent, jupyterSaveContent } from '../../services/tauriIpc';
import { useKernel } from '../../hooks/useKernel';
import { NotebookToolbar } from './NotebookToolbar';
import { CellEditor } from './CellEditor';
import {
  createNotebookCell,
  resolveRunModeTransition,
  type RunCellMode,
} from './notebookCellOps';
import './Notebook.css';

/* ── Button class tokens (for empty state) ───────────────────────── */
const nbBtn =
  'inline-flex items-center justify-center gap-1 min-h-[26px] px-2 ' +
  'border border-transparent rounded-sm bg-transparent ' +
  'text-nb-text-secondary text-xs leading-none whitespace-nowrap ' +
  'hover:border-nb-btn-hover-border hover:bg-nb-btn-hover ' +
  'disabled:opacity-45 disabled:cursor-default transition-colors';

const nbBtnPrimary =
  'inline-flex items-center justify-center gap-1 min-h-[26px] px-2 ' +
  'border border-nb-btn-primary rounded-sm bg-nb-btn-primary text-white ' +
  'text-xs leading-none whitespace-nowrap ' +
  'hover:border-nb-btn-primary-hover hover:bg-nb-btn-primary-hover ' +
  'disabled:opacity-45 disabled:cursor-default transition-colors';

interface NotebookEditorProps {
  path: string;
  serverId?: string;
  onClose?: () => void;
  onContextChange?: (ctx: AgentChatContext) => void;
}

export const NotebookEditor: React.FC<NotebookEditorProps> = ({
  path,
  serverId,
  onContextChange,
}) => {
  const [cells, setCells] = useState<Cell[]>([]);
  const [nbMetadata, setNbMetadata] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCellIndex, setActiveCellIndex] = useState<number>(0);
  const [executingCellId, setExecutingCellId] = useState<string | null>(null);

  // Extract notebook filename from path
  const notebookName = path.split('/').pop() || path;

  // Handle incoming outputs from kernel WebSocket
  const handleCellOutput = useCallback(
    (cellId: string, output: CellOutput) => {
      setCells((prevCells) =>
        prevCells.map((cell) => {
          if (cell.id === cellId) {
            const currentOutputs = cell.outputs || [];
            // If it's a stream of the same name (e.g. stdout), we can merge text or append
            if (
              output.output_type === 'stream' &&
              currentOutputs.length > 0 &&
              currentOutputs[currentOutputs.length - 1].output_type === 'stream' &&
              (currentOutputs[currentOutputs.length - 1] as any).name === output.name
            ) {
              const last = currentOutputs[currentOutputs.length - 1] as any;
              const updatedLast = {
                ...last,
                text: (typeof last.text === 'string' ? last.text : last.text.join('')) +
                      (typeof output.text === 'string' ? output.text : output.text.join('')),
              };
              return {
                ...cell,
                outputs: [
                  ...currentOutputs.slice(0, currentOutputs.length - 1),
                  updatedLast,
                ],
              };
            }
            return {
              ...cell,
              outputs: [...currentOutputs, output],
            };
          }
          return cell;
        })
      );
      setIsDirty(true);
    },
    []
  );

  const handleCellExecutionDone = useCallback(
    (cellId: string, executionCount?: number) => {
      setCells((prevCells) =>
        prevCells.map((cell) => {
          if (cell.id === cellId) {
            return {
              ...cell,
              execution_count:
                executionCount !== undefined ? executionCount : cell.execution_count,
            };
          }
          return cell;
        })
      );
      setExecutingCellId((prev) => (prev === cellId ? null : prev));
      setIsDirty(true);
    },
    []
  );

  // Initialize kernel hook
  const kernel = useKernel({
    serverId,
    notebookPath: path,
    kernelName: nbMetadata?.kernelspec?.name || 'python3',
    onCellOutput: handleCellOutput,
    onCellExecutionDone: handleCellExecutionDone,
  });
  const canRunCode = kernel.isReady;
  const activeCellType = cells[activeCellIndex]?.cell_type || 'code';

  // Sync workspace context with AI Agent
  useEffect(() => {
    if (!onContextChange) return;
    const activeCell = cells[activeCellIndex];
    const rawSource = activeCell?.source;
    const code = Array.isArray(rawSource) ? rawSource.join('') : (rawSource || '');
    let lastErr = undefined;
    if (activeCell?.outputs) {
      for (const out of activeCell.outputs) {
        if (out.output_type === 'error') {
          const errOut = out as any;
          lastErr = `${errOut.ename}: ${errOut.evalue}\n${(errOut.traceback || []).join('\n')}`;
        }
      }
    }
    onContextChange({
      notebook_path: path,
      active_cell_index: activeCellIndex,
      active_cell_code: code,
      kernel_status: kernel.status,
      last_error: lastErr,
    });
  }, [path, activeCellIndex, cells, kernel.status, onContextChange]);

  // Load Notebook content
  useEffect(() => {
    let isMounted = true;
    const loadNotebook = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const item = await jupyterGetContent(path, serverId);
        if (!isMounted) return;

        const content = item.content as Record<string, any>;
        if (content && Array.isArray(content.cells)) {
          const loadedCells: Cell[] = content.cells.map((c: any, idx: number) => ({
            id: c.id || `cell-${idx}-${crypto.randomUUID()}`,
            cell_type: c.cell_type || 'code',
            source: c.source || '',
            outputs: c.outputs || [],
            execution_count: c.execution_count ?? null,
            metadata: c.metadata || {},
          }));
          setCells(loadedCells);
          setNbMetadata(content.metadata || {});
        } else {
          // Empty or new notebook
          setCells([
            createNotebookCell('code'),
          ]);
        }
        setIsDirty(false);

        // Start session & connect kernel
        await kernel.startSession();
      } catch (e: unknown) {
        if (isMounted) {
          const msg = e instanceof Error ? e.message : String(e);
          setLoadError(msg);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadNotebook();
    return () => {
      isMounted = false;
    };
  }, [path, serverId]);

  // Save Notebook
  const handleSave = useCallback(async () => {
    if (isSaving || !isDirty) return;
    setIsSaving(true);
    try {
      const nbData = {
        cells: cells.map((c) => ({
          id: c.id,
          cell_type: c.cell_type,
          execution_count: c.cell_type === 'code' ? c.execution_count ?? null : null,
          metadata: c.metadata || {},
          outputs: c.cell_type === 'code' ? c.outputs || [] : [],
          source: c.source,
        })),
        metadata: nbMetadata || {},
        nbformat: 4,
        nbformat_minor: 5,
      };
      await jupyterSaveContent(path, nbData, serverId);
      setIsDirty(false);
    } catch (e: unknown) {
      console.error('Failed to save notebook:', e);
    } finally {
      setIsSaving(false);
    }
  }, [cells, nbMetadata, path, serverId, isSaving, isDirty]);

  // Ctrl+S / Cmd+S shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Cell operations
  const handleRunCell = async (index: number, mode: RunCellMode = 'stay') => {
    const cell = cells[index];
    if (!cell || cell.cell_type !== 'code') return;
    if (!canRunCode) return;

    const sourceText =
      typeof cell.source === 'string' ? cell.source : cell.source.join('');

    // Use functional update to prevent overwriting outputs from other cells
    setCells((prevCells) => {
      const clearedCells = prevCells.map((c, i) =>
        i === index ? { ...c, outputs: [] } : c
      );
      return resolveRunModeTransition(clearedCells, index, mode).cells;
    });

    if (mode === 'stay') {
      setActiveCellIndex(index);
    } else if (mode === 'insert') {
      setActiveCellIndex(index + 1);
    } else if (mode === 'advance') {
      setActiveCellIndex(index < cells.length - 1 ? index + 1 : cells.length);
    }
    
    setIsDirty(true);
    setExecutingCellId(cell.id || null);

    const didSend = await kernel.executeCell(cell.id || '', sourceText);
    if (!didSend) {
      setExecutingCellId((prev) => (prev === cell.id ? null : prev));
    }
  };

  const handleRunAll = async () => {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].cell_type === 'code') {
        setActiveCellIndex(i);
        await handleRunCell(i, 'stay');
      }
    }
  };

  const handleAddCell = (type: CellType) => {
    const newCell = createNotebookCell(type);
    const insertIdx = activeCellIndex + 1;
    const newCells = [
      ...cells.slice(0, insertIdx),
      newCell,
      ...cells.slice(insertIdx),
    ];
    setCells(newCells);
    setActiveCellIndex(insertIdx);
    setIsDirty(true);
  };

  const handleCellTypeChange = (index: number, newType: CellType) => {
    setCells((prev) =>
      prev.map((c, i) =>
        i === index
          ? { ...c, cell_type: newType, outputs: [], execution_count: null }
          : c
      )
    );
    setIsDirty(true);
  };

  const handleDeleteCell = (index: number) => {
    if (cells.length <= 1) return; // Keep at least one cell
    const newCells = cells.filter((_, i) => i !== index);
    setCells(newCells);
    setActiveCellIndex((prev) => Math.min(prev, newCells.length - 1));
    setIsDirty(true);
  };

  const handleMoveCell = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= cells.length) return;

    const newCells = [...cells];
    const temp = newCells[index];
    newCells[index] = newCells[targetIdx];
    newCells[targetIdx] = temp;

    setCells(newCells);
    setActiveCellIndex(targetIdx);
    setIsDirty(true);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 bg-nb-shell text-nb-text-secondary text-[13px]">
        <Loader2 size={30} className="animate-spin" />
        <span>Loading Notebook {notebookName}...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 bg-nb-shell text-nb-error-text text-[13px]">
        <AlertTriangle size={44} />
        <div className="max-w-[620px] text-center">
          <h3 className="mb-2 text-nb-text">Failed to Load Notebook</h3>
          <p className="m-0 py-2.5 px-3 border border-nb-error-border bg-nb-cell text-nb-error-text font-mono text-xs text-left">
            {loadError}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden bg-nb-shell text-nb-text">
      <NotebookToolbar
        notebookName={notebookName}
        kernelName={nbMetadata?.kernelspec?.display_name || kernel.kernel?.name || 'Python 3'}
        status={kernel.status}
        isDirty={isDirty}
        isSaving={isSaving}
        isConnecting={kernel.isConnecting}
        canRun={canRunCode}
        activeCellType={activeCellType}
        onSave={handleSave}
        onAddCode={() => handleAddCell('code')}
        onAddMarkdown={() => handleAddCell('markdown')}
        onRunSelected={() => handleRunCell(activeCellIndex, 'stay')}
        onRunAll={handleRunAll}
        onInterrupt={kernel.interrupt}
        onRestart={kernel.restart}
        onConnect={kernel.startSession}
        onActiveCellTypeChange={(type) =>
          handleCellTypeChange(activeCellIndex, type)
        }
      />

      {kernel.error && (
        <div className="px-3.5 py-2 border-b border-nb-error-border bg-nb-error text-nb-error-text text-xs">
          {kernel.error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full max-w-[1180px] mx-auto px-7 pt-[22px] max-[760px]:px-2.5 max-[760px]:pt-3.5">
        {cells.map((cell, idx) => (
          <CellEditor
            key={cell.id}
            cell={cell}
            index={idx}
            isActive={idx === activeCellIndex}
            isExecuting={executingCellId === cell.id}
            canRun={canRunCode}
            onSelect={() => setActiveCellIndex(idx)}
            onChange={(newSource) => {
              setCells((prev) =>
                prev.map((c, i) =>
                  i === idx ? { ...c, source: newSource } : c
                )
              );
              setIsDirty(true);
            }}
            onTypeChange={(newType) => handleCellTypeChange(idx, newType)}
            onRun={() => handleRunCell(idx, 'stay')}
            onRunAndAdvance={() => handleRunCell(idx, 'advance')}
            onRunAndInsert={() => handleRunCell(idx, 'insert')}
            onDelete={() => handleDeleteCell(idx)}
            onMoveUp={() => handleMoveCell(idx, 'up')}
            onMoveDown={() => handleMoveCell(idx, 'down')}
            canMoveUp={idx > 0}
            canMoveDown={idx < cells.length - 1}
          />
        ))}

        {cells.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[220px] gap-3 border border-dashed border-nb-cell-border bg-nb-cell text-nb-text-secondary">
            <FileCode size={40} />
            <span>This notebook has no cells yet.</span>
            <div className="flex flex-wrap justify-center gap-1.5">
              <button
                onClick={() => handleAddCell('code')}
                className={nbBtnPrimary}
              >
                + Add Code Cell
              </button>
              <button
                onClick={() => handleAddCell('markdown')}
                className={nbBtn}
              >
                + Add Markdown Cell
              </button>
            </div>
          </div>
        )}

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
};
