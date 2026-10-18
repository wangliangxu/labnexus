import { t } from '../../i18n';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Loader2, AlertTriangle, FileCode } from 'lucide-react';
import type { Cell, CellType, CellOutput } from '../../types/jupyter';
import type { AgentChatContext } from '../../types/agent';
import {
  agentCompleteNotebookAction,
  jupyterGetContent,
  jupyterSaveContent,
} from '../../services/tauriIpc';
import { useKernel } from '../../hooks/useKernel';
import { NotebookToolbar } from './NotebookToolbar';
import { CellEditor } from './CellEditor';
import {
  createNotebookCell,
  prepareRunCellExecutionState,
  updateCellSourceSnapshot,
  type RunCellMode,
} from './notebookCellOps';
import {
  extractNotebookToc,
  resolveActiveTocHeadingId,
  type NotebookCursorPosition,
  type NotebookTocScrollRequest,
  type NotebookTocState,
} from './notebookToc';
import './Notebook.css';
import {
  GLOBAL_SETTINGS_CHANGED_EVENT,
  isEditableKeyboardTarget,
  keyboardEventMatchesShortcut,
  loadGlobalSettings,
  type GlobalSettings,
} from '../../services/globalSettings';

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
  isActiveTab?: boolean;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onContextChange?: (ctx: AgentChatContext) => void;
  tocOwnerId?: string;
  tocScrollRequest?: NotebookTocScrollRequest | null;
  onTocChange?: (ownerId: string, state: NotebookTocState) => void;
}

interface AgentNotebookActionEvent {
  action_id: string;
  action: 'add_cell' | 'save' | 'list_cells' | 'update_cell' | 'delete_cell';
  server_id: string;
  notebook_path: string;
  active_cell_id?: string;
  active_cell_index?: number;
  arguments: {
    cell_type?: CellType;
    source?: string;
    position?: 'above' | 'below' | 'end';
    cell_id?: string;
    cell_index?: number;
    include_outputs?: boolean;
  };
}

export const NotebookEditor: React.FC<NotebookEditorProps> = ({
  path,
  serverId,
  isActiveTab = true,
  onDirtyChange,
  onContextChange,
  tocOwnerId,
  tocScrollRequest,
  onTocChange,
}) => {
  const [cells, setCells] = useState<Cell[]>([]);
  const [nbMetadata, setNbMetadata] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCellIndex, setActiveCellIndex] = useState<number>(0);
  const [executingCellIds, setExecutingCellIds] = useState<string[]>([]);
  const [runCurrentCellShortcut, setRunCurrentCellShortcut] = useState(
    () => loadGlobalSettings().runCurrentCellShortcut
  );
  const [cursorPosition, setCursorPosition] = useState<NotebookCursorPosition>({
    cellIndex: 0,
    line: 0,
  });
  const cellsRef = useRef<Cell[]>([]);
  const cellElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const sourceCommitTimersRef = useRef<Map<string, number>>(new Map());
  const pendingExecutionResolversRef = useRef<Map<string, Array<(hadError: boolean) => void>>>(
    new Map()
  );

  // Extract notebook filename from path
  const notebookName = path.split('/').pop() || path;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const resolvePendingCellExecution = useCallback((cellId: string, hadError: boolean) => {
    const waiters = pendingExecutionResolversRef.current.get(cellId);
    if (waiters) {
      pendingExecutionResolversRef.current.delete(cellId);
      waiters.forEach((resolve) => resolve(hadError));
    }
  }, []);

  const clearAllPendingCellExecutions = useCallback(() => {
    pendingExecutionResolversRef.current.forEach((waiters) => {
      waiters.forEach((resolve) => resolve(true));
    });
    pendingExecutionResolversRef.current.clear();
    setExecutingCellIds([]);
  }, []);

  const setCellsSnapshot = useCallback((nextCells: Cell[]) => {
    cellsRef.current = nextCells;
    setCells(nextCells);
  }, []);

  const updateCellsSnapshot = useCallback((updater: (current: Cell[]) => Cell[]) => {
    const nextCells = updater(cellsRef.current);
    cellsRef.current = nextCells;
    setCells(nextCells);
    return nextCells;
  }, []);

  const flushSourceCommits = useCallback(() => {
    sourceCommitTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    sourceCommitTimersRef.current.clear();
    setCells(cellsRef.current);
  }, []);

  const scheduleSourceCommit = useCallback((cellId: string) => {
    const currentTimer = sourceCommitTimersRef.current.get(cellId);
    if (currentTimer !== undefined) {
      window.clearTimeout(currentTimer);
    }

    const timerId = window.setTimeout(() => {
      sourceCommitTimersRef.current.delete(cellId);
      setCells(cellsRef.current);
    }, 180);
    sourceCommitTimersRef.current.set(cellId, timerId);
  }, []);

  useEffect(() => {
    return () => {
      sourceCommitTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      sourceCommitTimersRef.current.clear();
      clearAllPendingCellExecutions();
    };
  }, [clearAllPendingCellExecutions]);

  useEffect(() => {
    const handleSettingsChanged = (event: Event) => {
      const settings = (event as CustomEvent<GlobalSettings>).detail;
      setRunCurrentCellShortcut(settings.runCurrentCellShortcut);
    };
    window.addEventListener(GLOBAL_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    return () => window.removeEventListener(GLOBAL_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  }, []);

  // Handle incoming outputs from kernel WebSocket
  const handleCellOutput = useCallback(
    (cellId: string, output: CellOutput) => {
      updateCellsSnapshot((prevCells) =>
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
    [updateCellsSnapshot]
  );

  const handleCellExecutionDone = useCallback(
    (cellId: string, executionCount?: number, hadError?: boolean) => {
      updateCellsSnapshot((prevCells) =>
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
      setExecutingCellIds((prev) => prev.filter((id) => id !== cellId));
      resolvePendingCellExecution(cellId, Boolean(hadError));
      setIsDirty(true);
    },
    [resolvePendingCellExecution, updateCellsSnapshot]
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
  const tocHeadings = useMemo(() => extractNotebookToc(cells), [cells]);
  const activeTocHeadingId = useMemo(
    () => resolveActiveTocHeadingId(tocHeadings, cursorPosition),
    [cursorPosition, tocHeadings]
  );

  useEffect(() => {
    if (!tocOwnerId || !onTocChange) return;
    onTocChange(tocOwnerId, {
      headings: tocHeadings,
      activeHeadingId: activeTocHeadingId,
    });
  }, [activeTocHeadingId, onTocChange, tocHeadings, tocOwnerId]);

  useEffect(() => {
    if (!tocScrollRequest || tocScrollRequest.tabId !== tocOwnerId) return;

    const heading = tocHeadings.find((item) => item.id === tocScrollRequest.headingId);
    if (!heading) return;

    const target = cellElementsRef.current.get(heading.cellId);
    if (!target) return;

    setActiveCellIndex(heading.cellIndex);
    setCursorPosition({ cellIndex: heading.cellIndex, line: heading.line });
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [tocOwnerId, tocScrollRequest, tocHeadings]);

  const extractCellLastError = useCallback((cell?: Cell): string | undefined => {
    if (!cell?.outputs) return undefined;
    let lastErr: string | undefined;
    for (const out of cell.outputs) {
      if (out.output_type === 'error') {
        const errOut = out as any;
        lastErr = `${errOut.ename}: ${errOut.evalue}\n${(errOut.traceback || []).join('\n')}`;
      }
    }
    return lastErr;
  }, []);

  // Sync workspace context with AI Agent (only when this notebook tab is active)
  useEffect(() => {
    if (!onContextChange || !isActiveTab) return;
    const activeCell = cells[activeCellIndex];
    const rawSource = activeCell?.source;
    const code = Array.isArray(rawSource) ? rawSource.join('') : (rawSource || '');
    const lastErr = extractCellLastError(activeCell);
    onContextChange({
      server_id: serverId,
      notebook_path: path,
      session_id: kernel.session?.id,
      kernel_id: kernel.kernel?.id,
      active_cell_id: activeCell?.id,
      active_cell_index: activeCellIndex,
      active_cell_code: code,
      kernel_status: kernel.status,
      last_error: lastErr,
    });
  }, [
    path,
    serverId,
    isActiveTab,
    activeCellIndex,
    cells,
    kernel.session?.id,
    kernel.kernel?.id,
    kernel.status,
    onContextChange,
    extractCellLastError,
  ]);

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
          setCellsSnapshot(loadedCells);
          setActiveCellIndex(0);
          setCursorPosition({ cellIndex: 0, line: 0 });
          setNbMetadata(content.metadata || {});
        } else {
          // Empty or new notebook
          setCellsSnapshot([
            createNotebookCell('code'),
          ]);
          setActiveCellIndex(0);
          setCursorPosition({ cellIndex: 0, line: 0 });
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
  }, [path, serverId, setCellsSnapshot]);

  // Save Notebook
  const handleSave = useCallback(async () => {
    if (isSaving) {
      throw new Error('Notebook save is already in progress');
    }
    if (!isDirty) return;
    flushSourceCommits();
    setIsSaving(true);
    try {
      const latestCells = cellsRef.current;
      const nbData = {
        cells: latestCells.map((c) => ({
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
      throw e;
    } finally {
      setIsSaving(false);
    }
  }, [flushSourceCommits, nbMetadata, path, serverId, isSaving, isDirty]);

  // Execute notebook mutations requested by the Agent and acknowledge the real result.
  useEffect(() => {
    const resolveTargetCellIndex = (payload: AgentNotebookActionEvent): number => {
      const current = cellsRef.current;
      if (payload.arguments.cell_id) {
        const idx = current.findIndex((c) => c.id === payload.arguments.cell_id);
        if (idx === -1) {
          throw new Error(`Cell with id '${payload.arguments.cell_id}' not found in '${path}'.`);
        }
        return idx;
      }
      if (typeof payload.arguments.cell_index === 'number') {
        if (payload.arguments.cell_index < 0 || payload.arguments.cell_index >= current.length) {
          throw new Error(
            `cell_index ${payload.arguments.cell_index} is out of bounds (notebook has ${current.length} cells).`
          );
        }
        return payload.arguments.cell_index;
      }
      if (payload.active_cell_id) {
        const idx = current.findIndex((c) => c.id === payload.active_cell_id);
        if (idx !== -1) return idx;
      }
      if (
        typeof payload.active_cell_index === 'number' &&
        payload.active_cell_index >= 0 &&
        payload.active_cell_index < current.length
      ) {
        return payload.active_cell_index;
      }
      return Math.min(Math.max(0, activeCellIndex), Math.max(0, current.length - 1));
    };

    const unlisten = listen<AgentNotebookActionEvent>(
      'agent:notebook_action',
      async ({ payload }) => {
        if (payload.notebook_path !== path || payload.server_id !== serverId) return;

        try {
          if (payload.action === 'save') {
            await handleSave();
            await agentCompleteNotebookAction(
              payload.action_id,
              true,
              `Notebook '${path}' saved successfully.`
            );
            return;
          }

          if (payload.action === 'list_cells') {
            flushSourceCommits();
            const includeOutputs = payload.arguments.include_outputs !== false;
            const summary = cellsRef.current.map((cell, index) => {
              const sourceText = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
              const entry: Record<string, unknown> = {
                index,
                id: cell.id,
                cell_type: cell.cell_type,
                execution_count: cell.execution_count ?? null,
                is_active: index === activeCellIndex,
                source: sourceText,
              };
              if (includeOutputs && cell.cell_type === 'code' && cell.outputs?.length) {
                entry.outputs = cell.outputs.map((out) => {
                  if (out.output_type === 'stream') {
                    const text = Array.isArray(out.text) ? out.text.join('') : out.text;
                    return { output_type: 'stream', name: out.name, text: text.slice(0, 1000) };
                  }
                  if (out.output_type === 'error') {
                    return {
                      output_type: 'error',
                      ename: out.ename,
                      evalue: out.evalue,
                    };
                  }
                  const plain = out.data?.['text/plain'];
                  const plainText = Array.isArray(plain) ? plain.join('') : (plain || '');
                  return {
                    output_type: out.output_type,
                    mime_types: Object.keys(out.data || {}),
                    text_preview: String(plainText).slice(0, 1000),
                  };
                });
              }
              return entry;
            });
            await agentCompleteNotebookAction(
              payload.action_id,
              true,
              JSON.stringify(
                {
                  notebook_path: path,
                  cell_count: summary.length,
                  active_cell_index: activeCellIndex,
                  cells: summary,
                },
                null,
                2
              )
            );
            return;
          }

          if (payload.action === 'add_cell') {
            const cellType = payload.arguments.cell_type ?? 'code';
            const position = payload.arguments.position ?? 'below';
            const newCell = {
              ...createNotebookCell(cellType),
              source: payload.arguments.source ?? '',
            };
            const requestedIndex = payload.active_cell_id
              ? cellsRef.current.findIndex((cell) => cell.id === payload.active_cell_id)
              : (payload.active_cell_index ?? activeCellIndex);
            const anchorIndex = requestedIndex >= 0 ? requestedIndex : activeCellIndex;
            const insertIndex = position === 'end'
              ? cellsRef.current.length
              : position === 'above'
                ? Math.max(0, anchorIndex)
                : Math.min(cellsRef.current.length, anchorIndex + 1);

            updateCellsSnapshot((current) => [
              ...current.slice(0, insertIndex),
              newCell,
              ...current.slice(insertIndex),
            ]);
            setActiveCellIndex(insertIndex);
            setCursorPosition({ cellIndex: insertIndex, line: 0 });
            setIsDirty(true);
            await agentCompleteNotebookAction(
              payload.action_id,
              true,
              `Added a ${cellType} cell (id: ${newCell.id}) at index ${insertIndex} in '${path}'.`
            );
            return;
          }

          if (payload.action === 'update_cell') {
            flushSourceCommits();
            if (cellsRef.current.length === 0) {
              throw new Error(`Notebook '${path}' has no cells to update.`);
            }
            const targetIndex = resolveTargetCellIndex(payload);
            const targetCell = cellsRef.current[targetIndex];
            const nextType = payload.arguments.cell_type ?? targetCell.cell_type;
            const nextSource =
              payload.arguments.source !== undefined
                ? payload.arguments.source
                : targetCell.source;

            updateCellsSnapshot((current) =>
              current.map((c, idx) =>
                idx === targetIndex
                  ? {
                      ...c,
                      cell_type: nextType,
                      source: nextSource,
                      ...(nextType !== c.cell_type ? { outputs: [], execution_count: null } : {}),
                    }
                  : c
              )
            );
            setActiveCellIndex(targetIndex);
            setCursorPosition({ cellIndex: targetIndex, line: 0 });
            setIsDirty(true);
            await agentCompleteNotebookAction(
              payload.action_id,
              true,
              `Updated cell at index ${targetIndex} (id: ${targetCell.id}) in '${path}'.`
            );
            return;
          }

          if (payload.action === 'delete_cell') {
            flushSourceCommits();
            if (cellsRef.current.length === 0) {
              throw new Error(`Notebook '${path}' has no cells to delete.`);
            }
            const targetIndex = resolveTargetCellIndex(payload);
            const targetCell = cellsRef.current[targetIndex];
            if (cellsRef.current.length <= 1) {
              const replacement = createNotebookCell('code');
              setCellsSnapshot([replacement]);
              setActiveCellIndex(0);
              setCursorPosition({ cellIndex: 0, line: 0 });
              setIsDirty(true);
              await agentCompleteNotebookAction(
                payload.action_id,
                true,
                `Cleared the only remaining cell (index 0) in '${path}'.`
              );
              return;
            }

            const nextCells = cellsRef.current.filter((_, idx) => idx !== targetIndex);
            const nextActive = Math.min(activeCellIndex, nextCells.length - 1);
            setCellsSnapshot(nextCells);
            setActiveCellIndex(nextActive);
            setCursorPosition({ cellIndex: nextActive, line: 0 });
            setIsDirty(true);
            await agentCompleteNotebookAction(
              payload.action_id,
              true,
              `Deleted cell at index ${targetIndex} (id: ${targetCell.id}) from '${path}'.`
            );
            return;
          }

          throw new Error(`Unsupported notebook action: ${payload.action}`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          try {
            await agentCompleteNotebookAction(payload.action_id, false, message);
          } catch (ackError) {
            console.error('Failed to acknowledge Agent notebook action:', ackError);
          }
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeCellIndex, flushSourceCommits, handleSave, path, serverId, setCellsSnapshot, updateCellsSnapshot]);

  // Ctrl+S / Cmd+S shortcut (active tab only)
  useEffect(() => {
    if (!isActiveTab) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, isActiveTab]);

  // Cell operations
  const handleRunCell = async (
    index: number,
    mode: RunCellMode = 'stay',
    waitForCompletion = false
  ): Promise<boolean> => {
    flushSourceCommits();
    const currentCells = cellsRef.current;
    const cell = currentCells[index];
    if (!cell || cell.cell_type !== 'code') return false;
    if (!canRunCode) return false;

    const cellId = cell.id || `cell-${index}`;
    const sourceText =
      typeof cell.source === 'string' ? cell.source : cell.source.join('');
    const transition = prepareRunCellExecutionState(currentCells, index, mode);
    setCellsSnapshot(transition.cells);
    setActiveCellIndex(transition.activeCellIndex);
    setCursorPosition({ cellIndex: transition.activeCellIndex, line: 0 });
    setIsDirty(true);
    setExecutingCellIds((prev) => (prev.includes(cellId) ? prev : [...prev, cellId]));

    if (mode !== 'stay') {
      const nextCell = transition.cells[transition.activeCellIndex];
      const nextCellId = nextCell?.id;
      requestAnimationFrame(() => {
        const element = nextCellId ? cellElementsRef.current.get(nextCellId) : undefined;
        const editor = element?.querySelector<HTMLElement>('.cm-content');
        (editor ?? element)?.focus();
      });
    }

    const completionPromise = waitForCompletion
      ? new Promise<boolean>((resolve) => {
          const existing = pendingExecutionResolversRef.current.get(cellId) || [];
          existing.push(resolve);
          pendingExecutionResolversRef.current.set(cellId, existing);
        })
      : null;

    const didSend = await kernel.executeCell(cellId, sourceText);
    if (!didSend) {
      setExecutingCellIds((prev) => prev.filter((id) => id !== cellId));
      resolvePendingCellExecution(cellId, true);
      return true;
    }

    if (completionPromise) {
      return await completionPromise;
    }
    return false;
  };

  // Run the selected cell even when CodeMirror itself does not have focus.
  useEffect(() => {
    if (!isActiveTab) return;
    const handleNotebookShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        isEditableKeyboardTarget(event.target) ||
        !keyboardEventMatchesShortcut(event, runCurrentCellShortcut)
      ) {
        return;
      }

      event.preventDefault();
      void handleRunCell(activeCellIndex, 'advance');
    };

    window.addEventListener('keydown', handleNotebookShortcut);
    return () => window.removeEventListener('keydown', handleNotebookShortcut);
  }, [activeCellIndex, runCurrentCellShortcut, canRunCode, isActiveTab]);

  const handleRunAll = async () => {
    flushSourceCommits();
    const currentCells = cellsRef.current;
    for (let i = 0; i < currentCells.length; i++) {
      if (currentCells[i].cell_type === 'code') {
        setActiveCellIndex(i);
        setCursorPosition({ cellIndex: i, line: 0 });
        const hadError = await handleRunCell(i, 'stay', true);
        if (hadError) {
          break;
        }
      }
    }
  };

  const handleInterruptKernel = useCallback(async () => {
    clearAllPendingCellExecutions();
    await kernel.interrupt();
  }, [clearAllPendingCellExecutions, kernel]);

  const handleRestartKernel = useCallback(async () => {
    clearAllPendingCellExecutions();
    await kernel.restart();
  }, [clearAllPendingCellExecutions, kernel]);

  const handleAddCell = (type: CellType, afterIndex = activeCellIndex) => {
    const newCell = createNotebookCell(type);
    const currentCells = cellsRef.current;
    const insertIdx = Math.min(afterIndex + 1, currentCells.length);
    const newCells = [
      ...currentCells.slice(0, insertIdx),
      newCell,
      ...currentCells.slice(insertIdx),
    ];
    setCellsSnapshot(newCells);
    setActiveCellIndex(insertIdx);
    setCursorPosition({ cellIndex: insertIdx, line: 0 });
    setIsDirty(true);
    requestAnimationFrame(() => {
      const element = cellElementsRef.current.get(newCell.id!);
      const editor = element?.querySelector<HTMLElement>('.cm-content');
      (editor ?? element)?.focus();
    });
  };

  const handleCellTypeChange = (index: number, newType: CellType) => {
    updateCellsSnapshot((prev) =>
      prev.map((c, i) =>
        i === index
          ? { ...c, cell_type: newType, outputs: [], execution_count: null }
          : c
      )
    );
    setIsDirty(true);
  };

  const handleDeleteCell = (index: number) => {
    const currentCells = cellsRef.current;
    if (currentCells.length <= 1) return; // Keep at least one cell
    const newCells = currentCells.filter((_, i) => i !== index);
    const nextActiveIndex = Math.min(activeCellIndex, newCells.length - 1);
    setCellsSnapshot(newCells);
    setActiveCellIndex(nextActiveIndex);
    setCursorPosition({ cellIndex: nextActiveIndex, line: 0 });
    setIsDirty(true);
  };

  const handleMoveCell = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const currentCells = cellsRef.current;
    if (targetIdx < 0 || targetIdx >= currentCells.length) return;

    const newCells = [...currentCells];
    const temp = newCells[index];
    newCells[index] = newCells[targetIdx];
    newCells[targetIdx] = temp;

    setCellsSnapshot(newCells);
    setActiveCellIndex(targetIdx);
    setCursorPosition({ cellIndex: targetIdx, line: 0 });
    setIsDirty(true);
  };

  const handleSelectCell = useCallback((index: number) => {
    setActiveCellIndex((current) => (current === index ? current : index));
    setCursorPosition((current) =>
      current.cellIndex === index ? current : { cellIndex: index, line: 0 }
    );
  }, []);

  const handleCellCursorChange = useCallback((index: number, line: number) => {
    setActiveCellIndex(index);
    setCursorPosition({ cellIndex: index, line });
  }, []);

  const handleCellSourceChange = useCallback(
    (cellId: string, index: number, newSource: string) => {
      updateCellSourceSnapshot(cellsRef, cellId, newSource);
      scheduleSourceCommit(cellId);
      setIsDirty(true);

      if (isActiveTab && index === activeCellIndex && onContextChange) {
        const activeCell = cellsRef.current[index];
        onContextChange({
          server_id: serverId,
          notebook_path: path,
          session_id: kernel.session?.id,
          kernel_id: kernel.kernel?.id,
          active_cell_id: cellId || activeCell?.id,
          active_cell_index: activeCellIndex,
          active_cell_code: newSource,
          kernel_status: kernel.status,
          last_error: extractCellLastError(activeCell),
        });
      }
    },
    [
      activeCellIndex,
      extractCellLastError,
      isActiveTab,
      kernel.kernel?.id,
      kernel.session?.id,
      kernel.status,
      onContextChange,
      path,
      scheduleSourceCommit,
      serverId,
    ]
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 bg-nb-shell text-nb-text-secondary text-[13px]">
        <Loader2 size={30} className="animate-spin" />
        <span>{t('Loading Notebook')} {notebookName}...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 bg-nb-shell text-nb-error-text text-[13px]">
        <AlertTriangle size={44} />
        <div className="max-w-[620px] text-center">
          <h3 className="mb-2 text-nb-text">{t('Failed to Load Notebook')}</h3>
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
        onRunSelected={() => {
          void handleRunCell(activeCellIndex, 'stay');
        }}
        onRunAll={() => {
          void handleRunAll();
        }}
        onInterrupt={handleInterruptKernel}
        onRestart={handleRestartKernel}
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
          {cells.map((cell, idx) => {
            const cellId = cell.id || `cell-${idx}`;
            return (
              <div
                key={cellId}
                style={{ scrollMarginTop: '48px' }}
                ref={(element) => {
                  if (element) {
                    cellElementsRef.current.set(cellId, element);
                  } else {
                    cellElementsRef.current.delete(cellId);
                  }
                }}
              >
                <CellEditor
                  cell={cell}
                  index={idx}
                  isActive={idx === activeCellIndex}
                  isExecuting={Boolean(cell.id && executingCellIds.includes(cell.id))}
                  canRun={canRunCode}
                  runCurrentCellShortcut={runCurrentCellShortcut}
                  onSelect={() => handleSelectCell(idx)}
                  onChange={(newSource) =>
                    handleCellSourceChange(cell.id || '', idx, newSource)
                  }
                  onAddCell={(type) => handleAddCell(type, idx)}
                  onRun={() => {
                    void handleRunCell(idx, 'stay');
                  }}
                  onRunAndAdvance={() => {
                    void handleRunCell(idx, 'advance');
                  }}
                  onRunAndInsert={() => {
                    void handleRunCell(idx, 'insert');
                  }}
                  onDelete={() => handleDeleteCell(idx)}
                  onMoveUp={() => handleMoveCell(idx, 'up')}
                  onMoveDown={() => handleMoveCell(idx, 'down')}
                  onCursorChange={(line) => handleCellCursorChange(idx, line)}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < cells.length - 1}
                />
              </div>
            );
          })}

          {cells.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[220px] gap-3 border border-dashed border-nb-cell-border bg-nb-cell text-nb-text-secondary">
              <FileCode size={40} />
              <span>{t('This notebook has no cells yet.')}</span>
              <div className="flex flex-wrap justify-center gap-1.5">
                <button
                  onClick={() => handleAddCell('code')}
                  className={nbBtnPrimary}
                >
                  {t('+ Add Code Cell')}
                </button>
                <button
                  onClick={() => handleAddCell('markdown')}
                  className={nbBtn}
                >
                  {t('+ Add Markdown Cell')}
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
