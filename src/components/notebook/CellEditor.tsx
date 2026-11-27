import { t, useLocale } from '../../i18n';
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { keymap, EditorView, type ViewUpdate } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import {
  Play,
  Trash2,
  ChevronUp,
  ChevronDown,
  Code2,
  FileText,
  Loader2,
  Plus,
} from 'lucide-react';
import type { Cell, CellType } from '../../types/jupyter';
import { CellOutputView } from './CellOutputView';
import { renderNotebookMarkdown } from './notebookMarkdown';

/* ── Shared button class tokens ──────────────────────────────────── */
const cellBtn =
  'inline-flex items-center justify-center gap-1 min-h-6 px-1.5 ' +
  'border border-transparent rounded-sm text-nb-text-secondary text-xs ' +
  'leading-none whitespace-nowrap ' +
  'hover:border-nb-btn-hover-border hover:bg-nb-btn-hover ' +
  'disabled:opacity-45 disabled:cursor-default transition-colors';

interface CellEditorProps {
  cell: Cell;
  index: number;
  isActive: boolean;
  isExecuting?: boolean;
  canRun?: boolean;
  runCurrentCellShortcut: string;
  onSelect: () => void;
  onChange: (source: string) => void;
  onAddCell: (type: CellType) => void;
  onRun: () => void;
  onRunAndAdvance: () => void;
  onRunAndInsert: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCursorChange?: (line: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const CellEditorComponent: React.FC<CellEditorProps> = ({
  cell,
  index,
  isActive,
  isExecuting = false,
  canRun = true,
  runCurrentCellShortcut,
  onSelect,
  onChange,
  onAddCell,
  onRun,
  onRunAndAdvance,
  onRunAndInsert,
  onDelete,
  onMoveUp,
  onMoveDown,
  onCursorChange,
  canMoveUp,
  canMoveDown,
}) => {
  const locale = useLocale();
  const isCode = cell.cell_type === 'code';
  const isMarkdown = cell.cell_type === 'markdown';
  const onRunRef = useRef(onRun);
  const onRunAndAdvanceRef = useRef(onRunAndAdvance);
  const onRunAndInsertRef = useRef(onRunAndInsert);
  onRunRef.current = onRun;
  onRunAndAdvanceRef.current = onRunAndAdvance;
  onRunAndInsertRef.current = onRunAndInsert;

  const externalSourceText = useMemo(() => {
    return typeof cell.source === 'string'
      ? cell.source
      : Array.isArray(cell.source)
        ? cell.source.join('')
        : '';
  }, [cell.source]);

  const [draftSource, setDraftSource] = useState(externalSourceText);

  useEffect(() => {
    setDraftSource(externalSourceText);
  }, [cell.id, externalSourceText]);

  /* ── Markdown edit/render mode (JupyterLab style) ────────────── */
  const [isEditingMarkdown, setIsEditingMarkdown] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const markdownEditScroll = useRef<{ scroller: HTMLElement; scrollTop: number } | null>(null);

  // When cell type changes to markdown, go to rendered mode
  useEffect(() => {
    if (!isMarkdown) {
      setIsEditingMarkdown(false);
    }
  }, [isMarkdown]);

  // When newly created markdown cell has no content, auto-enter edit mode
  useEffect(() => {
    if (isMarkdown && isActive) {
      if (externalSourceText.trim() === '') {
        setIsEditingMarkdown(true);
      }
    }
  }, [cell.id, externalSourceText, isActive, isMarkdown]);

  // Click outside markdown cell → exit edit mode
  useEffect(() => {
    if (!isMarkdown || !isEditingMarkdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cellRef.current && !cellRef.current.contains(e.target as Node)) {
        setIsEditingMarkdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMarkdown, isEditingMarkdown]);

  // Exit edit mode when cell loses active status
  useEffect(() => {
    if (!isActive && isEditingMarkdown) {
      setIsEditingMarkdown(false);
    }
  }, [isActive, isEditingMarkdown]);

  const handleMarkdownDoubleClick = useCallback(() => {
    if (!isMarkdown || isEditingMarkdown) return;

    const cellElement = cellRef.current;
    const scroller = cellElement?.closest<HTMLElement>('.notebook-scroll');
    if (!canMoveDown && cellElement && scroller) {
      const viewportBottom = scroller.getBoundingClientRect().top + scroller.clientHeight;
      if (cellElement.getBoundingClientRect().bottom <= viewportBottom + 1) {
        markdownEditScroll.current = { scroller, scrollTop: scroller.scrollTop };
      }
    }
    setIsEditingMarkdown(true);
  }, [canMoveDown, isMarkdown, isEditingMarkdown]);

  const handleCreateEditor = useCallback((view: EditorView) => {
    const previousScroll = markdownEditScroll.current;
    markdownEditScroll.current = null;
    if (!previousScroll) return;

    // CodeMirror measures wrapped lines on mount. Use the editor's laid-out height.
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      const { scroller, scrollTop } = previousScroll;
      const viewportTop = scroller.getBoundingClientRect().top;
      const editorBounds = view.dom.getBoundingClientRect();
      const cellBottom = cellRef.current?.getBoundingClientRect().bottom ?? editorBounds.bottom;
      const overflow = Math.ceil(cellBottom - viewportTop - scroller.clientHeight);
      scroller.scrollTop = Math.max(scrollTop, scroller.scrollTop + Math.max(0, overflow));

      // With the first line above the viewport, start typing at the visible end.
      if (view.dom.getBoundingClientRect().top < viewportTop) {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }
    });
  }, []);

  /* ── Dark theme detection for CodeMirror ─────────────────────── */
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDarkTheme(theme === 'dark');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  /* ── Rendered markdown HTML ──────────────────────────────────── */
  const renderedMarkdown = useMemo(() => {
    if (!isMarkdown) return '';
    const raw = draftSource.trim();
    if (!raw) return `<p class="nb-md-placeholder">${t('Double-click to edit…')}</p>`;
    return renderNotebookMarkdown(raw);
  }, [isMarkdown, draftSource, locale]);

  const extensions = useMemo(() => {
    const exitEditOnRun = () => {
      setIsEditingMarkdown(false);
    };
    const normalizedShortcut = runCurrentCellShortcut.trim().toLowerCase();
    const isModEnterCustom = normalizedShortcut === 'mod-enter';
    const isAltEnterCustom = normalizedShortcut === 'alt-enter';

    return [
      isCode ? python() : markdown(),
      ...(isMarkdown ? [EditorView.lineWrapping] : []),
      EditorView.contentAttributes.of({ 'aria-label': isMarkdown ? t('Markdown cell editor') : t('Code cell editor') }),
      Prec.highest(keymap.of([
        {
          key: runCurrentCellShortcut,
          run: () => {
            if (isMarkdown) {
              exitEditOnRun();
              onRunAndAdvanceRef.current();
              return true;
            }
            if (!canRun) return true;
            onRunAndAdvanceRef.current();
            return true;
          },
        },
        ...(!isModEnterCustom
          ? [{
              key: 'Mod-Enter',
              run: () => {
                if (isMarkdown) {
                  exitEditOnRun();
                  return true;
                }
                if (!canRun) return true;
                onRunRef.current();
                return true;
              },
            }]
          : []),
        ...(!isAltEnterCustom
          ? [{
              key: 'Alt-Enter',
              run: () => {
                if (isMarkdown) {
                  exitEditOnRun();
                  onRunAndInsertRef.current();
                  return true;
                }
                if (!canRun) return true;
                onRunAndInsertRef.current();
                return true;
              },
            }]
          : []),
        {
          key: 'Escape',
          run: () => {
            if (isMarkdown) {
              exitEditOnRun();
              return true;
            }
            return false;
          },
        },
      ])),
    ];
  }, [isCode, isMarkdown, canRun, runCurrentCellShortcut, locale]);

  const basicSetup = useMemo(
    () => ({
      lineNumbers: isCode,
      foldGutter: isCode,
      highlightActiveLine: false,
      highlightActiveLineGutter: false,
      autocompletion: true,
      bracketMatching: true,
    }),
    [isCode]
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      setDraftSource(value);
      onChange(value);
    },
    [onChange]
  );

  const handleEditorUpdate = useCallback(
    (update: ViewUpdate) => {
      if (!onCursorChange) return;
      if (!update.selectionSet && !update.docChanged && !update.focusChanged) return;
      // A pointer press in another cell selects that cell before CodeMirror
      // reports this editor's blur. Do not let the stale blur notification
      // select the previous cell again.
      if (!update.view.hasFocus) return;

      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head).number - 1;
      onCursorChange(line);
    },
    [onCursorChange]
  );

  /* ── Should we show the editor or the rendered markdown? ─────── */
  const showMarkdownRendered = isMarkdown && !isEditingMarkdown;

  return (
    <div
      ref={cellRef}
      tabIndex={-1}
      onPointerDown={onSelect}
      onDoubleClick={handleMarkdownDoubleClick}
      aria-label={t('Cell {index}, {type}', { index: index + 1, type: t(cell.cell_type === 'code' ? 'Code cell' : cell.cell_type === 'markdown' ? 'Markdown cell' : 'Raw cell') })}
      className={`group notebook-cell ${isCode ? 'notebook-cell--code' : ''} ${isActive ? 'notebook-cell--active' : ''} ${isExecuting ? 'notebook-cell--executing' : ''} mb-2`}
    >
      {isCode && (
        <div className="notebook-cell__prompt" title={t('Cell {index} execution count', { index: index + 1 })} aria-label={isExecuting ? t('Cell executing') : t('Execution count {count}', { count: cell.execution_count ?? t('not run') })}>
          [{isExecuting ? '*' : cell.execution_count ?? ' '}]:
        </div>
      )}

      {/* Cell Body */}
      <div className="notebook-cell__body pt-[5px] pr-[7px] pb-[7px]">
        <div
          className="notebook-cell__toolbar"
          role="group"
          aria-label={t('Cell {index} actions', { index: index + 1 })}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {isCode && <>
            <button type="button" onClick={(event) => { event.stopPropagation(); onRun(); }}
              disabled={isExecuting || !canRun} aria-label={t('Run cell')}
              title={canRun ? t('Run Cell (Ctrl/Cmd+Enter)') : t('Kernel is not ready')}
              className={`${cellBtn} text-nb-prompt`}>
              {isExecuting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
            <span className="notebook-cell__toolbar-divider" aria-hidden="true" />
          </>}
          <button type="button" onClick={(event) => { event.stopPropagation(); onAddCell('code'); }}
            title={t('Add code cell below')} aria-label={t('Add code cell below')} className={cellBtn}>
            <Plus size={11} /><Code2 size={14} />
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onAddCell('markdown'); }}
            title={t('Add Markdown cell below')} aria-label={t('Add Markdown cell below')} className={cellBtn}>
            <Plus size={11} /><FileText size={14} />
          </button>
          <span className="notebook-cell__toolbar-divider" aria-hidden="true" />
          <button type="button" onClick={(event) => { event.stopPropagation(); onMoveUp(); }}
            disabled={!canMoveUp} title={t('Move Cell Up')} aria-label={t('Move cell up')} className={cellBtn}>
            <ChevronUp size={15} />
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onMoveDown(); }}
            disabled={!canMoveDown} title={t('Move Cell Down')} aria-label={t('Move cell down')} className={cellBtn}>
            <ChevronDown size={15} />
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }}
            title={t('Delete Cell')} aria-label={t('Delete cell')}
            className={`${cellBtn} hover:border-nb-error-border hover:bg-nb-error hover:text-nb-error-text`}>
            <Trash2 size={15} />
          </button>
        </div>

        <div className="notebook-cell__input">
          {/* Rendered Markdown (JupyterLab style) */}
          {showMarkdownRendered ? (
            <div
              className="nb-markdown-rendered cursor-text"
              dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
              title={t('Double-click to edit')}
            />
          ) : (
            /* Editor */
            <div className="notebook-cell__editor min-w-0">
              <CodeMirror
                value={draftSource}
                extensions={extensions}
                onChange={handleEditorChange}
                onUpdate={handleEditorUpdate}
                onCreateEditor={handleCreateEditor}
                theme={isDarkTheme ? 'dark' : 'light'}
                basicSetup={basicSetup}
                autoFocus={isMarkdown && isEditingMarkdown}
                height="auto"
                className={`notebook-codemirror ${isMarkdown ? 'notebook-codemirror--markdown' : ''}`}
              />
            </div>
          )}
        </div>

        {/* Outputs */}
        {isCode && cell.outputs && cell.outputs.length > 0 && (
          <div className="notebook-cell__output">
            <CellOutputView outputs={cell.outputs} />
          </div>
        )}
      </div>
    </div>
  );
};

export const CellEditor = React.memo(
  CellEditorComponent,
  (prev, next) =>
    prev.cell === next.cell &&
    prev.index === next.index &&
    prev.isActive === next.isActive &&
    prev.isExecuting === next.isExecuting &&
    prev.canRun === next.canRun &&
    prev.runCurrentCellShortcut === next.runCurrentCellShortcut &&
    prev.canMoveUp === next.canMoveUp &&
    prev.canMoveDown === next.canMoveDown
);
