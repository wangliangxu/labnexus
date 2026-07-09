import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap, EditorView } from '@codemirror/view';
import { marked } from 'marked';
import {
  Play,
  Trash2,
  ChevronUp,
  ChevronDown,
  Code2,
  FileText,
  Loader2,
} from 'lucide-react';
import type { Cell, CellType } from '../../types/jupyter';
import { CellOutputView } from './CellOutputView';

/* ── Configure marked ───────────────────────────────────────────── */
marked.setOptions({ breaks: true, gfm: true });

/* ── JupyterLab-like light theme for CodeMirror ─────────────────── */
const jupyterLight = EditorView.theme({
  '&': { backgroundColor: 'var(--color-nb-editor)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-nb-gutter)',
    color: 'var(--color-nb-gutter-text)',
    borderRight: '1px solid var(--color-nb-editor-border)',
  },
});

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
  onSelect: () => void;
  onChange: (source: string) => void;
  onTypeChange: (type: CellType) => void;
  onRun: () => void;
  onRunAndAdvance: () => void;
  onRunAndInsert: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const CellEditorComponent: React.FC<CellEditorProps> = ({
  cell,
  index,
  isActive,
  isExecuting = false,
  canRun = true,
  onSelect,
  onChange,
  onTypeChange,
  onRun,
  onRunAndAdvance,
  onRunAndInsert,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) => {
  const isCode = cell.cell_type === 'code';
  const isMarkdown = cell.cell_type === 'markdown';

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
    if (isMarkdown && !isEditingMarkdown) {
      setIsEditingMarkdown(true);
    }
  }, [isMarkdown, isEditingMarkdown]);

  /* ── Dark theme detection for CodeMirror ─────────────────────── */
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme !== 'solarized';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDarkTheme(theme !== 'solarized');
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
    if (!raw) return '<p class="nb-md-placeholder">Double-click to edit…</p>';
    return marked.parse(raw) as string;
  }, [isMarkdown, draftSource]);

  const extensions = useMemo(() => {
    const exitEditOnRun = () => {
      setIsEditingMarkdown(false);
    };
    return [
      isCode ? python() : markdown(),
      keymap.of([
        {
          key: 'Shift-Enter',
          run: () => {
            if (isMarkdown) {
              exitEditOnRun();
              onRunAndAdvance();
              return true;
            }
            if (!canRun) return true;
            onRunAndAdvance();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            if (isMarkdown) {
              exitEditOnRun();
              return true;
            }
            if (!canRun) return true;
            onRun();
            return true;
          },
        },
        {
          key: 'Alt-Enter',
          run: () => {
            if (isMarkdown) {
              exitEditOnRun();
              onRunAndInsert();
              return true;
            }
            if (!canRun) return true;
            onRunAndInsert();
            return true;
          },
        },
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
      ]),
    ];
  }, [isCode, isMarkdown, onRun, onRunAndAdvance, onRunAndInsert, canRun]);

  const basicSetup = useMemo(
    () => ({
      lineNumbers: true,
      foldGutter: true,
      highlightActiveLine: isActive,
      autocompletion: true,
      bracketMatching: true,
    }),
    [isActive]
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      setDraftSource(value);
      onChange(value);
    },
    [onChange]
  );

  const prompt = isCode
    ? `In [${isExecuting ? '*' : cell.execution_count ?? ' '}]:`
    : cell.cell_type === 'markdown'
      ? 'Markdown'
      : 'Raw';

  /* ── Cell border logic ────────────────────────────────────────── */
  const borderOther = isActive
    ? 'border-nb-cell-active-border'
    : 'border-transparent';
  const borderLeft =
    isActive && !isExecuting
      ? 'border-l-nb-cell-active-left'
      : 'border-l-transparent';
  const cellBg = isActive ? 'bg-nb-cell' : 'bg-transparent';
  const hoverBorder = !isActive
    ? 'hover:border-nb-cell-border'
    : '';

  // Inline style ensures executing left-border always wins over hover
  const cellStyle = isExecuting
    ? { borderLeftColor: 'var(--color-nb-cell-executing-left)' }
    : undefined;

  /* ── Should we show the editor or the rendered markdown? ─────── */
  const showMarkdownRendered = isMarkdown && !isEditingMarkdown;

  return (
    <div
      ref={cellRef}
      onClick={onSelect}
      onDoubleClick={handleMarkdownDoubleClick}
      className={`group grid grid-cols-[82px_minmax(0,1fr)] gap-3 mb-2 border border-l-4 ${borderOther} ${borderLeft} ${cellBg} ${hoverBorder} max-[760px]:grid-cols-[58px_minmax(0,1fr)] max-[760px]:gap-2`}
      style={cellStyle}
    >
      {/* Prompt (In [n]:) */}
      <div
        className={`text-nb-prompt font-mono text-xs text-right whitespace-nowrap select-none max-[760px]:text-[11px] ${showMarkdownRendered ? 'pt-2.5' : 'pt-[37px]'
          }`}
        title={`Cell #${index + 1}`}
      >
        {prompt}
      </div>

      {/* Cell Body */}
      <div className="min-w-0 pt-[5px] pr-[7px] pb-[7px]">
        {/* Cell Tools – hidden when markdown is in rendered mode */}
        {!showMarkdownRendered && (
          <div
            className={`flex items-center justify-between min-h-7 gap-2 transition-opacity duration-150 max-[760px]:flex-wrap ${isActive
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 max-[760px]:opacity-100'
              }`}
          >
            {/* Type Switch */}
            <div className="inline-flex items-center gap-[3px] min-w-0">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onTypeChange('code');
                }}
                className={`${cellBtn} min-h-[23px] px-[7px] ${isCode
                    ? 'border-nb-type-selected-border bg-nb-type-selected text-nb-type-selected-text'
                    : ''
                  }`}
              >
                <Code2 size={13} />
                Code
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onTypeChange('markdown');
                }}
                className={`${cellBtn} min-h-[23px] px-[7px] ${cell.cell_type === 'markdown'
                    ? 'border-nb-type-selected-border bg-nb-type-selected text-nb-type-selected-text'
                    : ''
                  }`}
              >
                <FileText size={13} />
                Markdown
              </button>
            </div>

            {/* Actions */}
            <div className="inline-flex items-center gap-[3px] min-w-0">
              {isCode && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!canRun) return;
                    onRun();
                  }}
                  disabled={isExecuting || !canRun}
                  title={canRun ? 'Run Cell (Ctrl/Cmd+Enter)' : 'Kernel is not ready'}
                  className={`${cellBtn} min-w-14 text-nb-prompt`}
                >
                  {isExecuting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Running</span>
                    </>
                  ) : (
                    <>
                      <Play size={14} fill="currentColor" />
                      <span>Run</span>
                    </>
                  )}
                </button>
              )}

              <span className="w-px h-4 mx-0.5 bg-nb-cell-border" />

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveUp();
                }}
                disabled={!canMoveUp}
                title="Move Cell Up"
                className={cellBtn}
              >
                <ChevronUp size={15} />
              </button>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveDown();
                }}
                disabled={!canMoveDown}
                title="Move Cell Down"
                className={cellBtn}
              >
                <ChevronDown size={15} />
              </button>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                title="Delete Cell"
                className={`${cellBtn} hover:border-nb-error-border hover:bg-nb-error hover:text-nb-error-text`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Rendered Markdown (JupyterLab style) */}
        {showMarkdownRendered ? (
          <div
            className="nb-markdown-rendered cursor-text"
            dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
            title="Double-click to edit"
          />
        ) : (
          /* Editor */
          <div className="min-w-0 border border-nb-editor-border">
            <CodeMirror
              value={draftSource}
              extensions={extensions}
              onChange={handleEditorChange}
              theme={isDarkTheme ? oneDark : jupyterLight}
              basicSetup={basicSetup}
              autoFocus={isMarkdown && isEditingMarkdown}
              className="notebook-codemirror"
            />
          </div>
        )}

        {/* Outputs */}
        {isCode && cell.outputs && cell.outputs.length > 0 && (
          <CellOutputView outputs={cell.outputs} />
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
    prev.canMoveUp === next.canMoveUp &&
    prev.canMoveDown === next.canMoveDown
);
