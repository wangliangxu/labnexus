import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { keymap } from '@codemirror/view';
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

export const CellEditor: React.FC<CellEditorProps> = ({
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

  const sourceText = useMemo(() => {
    return typeof cell.source === 'string'
      ? cell.source
      : Array.isArray(cell.source)
      ? cell.source.join('')
      : '';
  }, [cell.source]);

  const extensions = useMemo(() => {
    return [
      isCode ? python() : markdown(),
      keymap.of([
        {
          key: 'Shift-Enter',
          run: () => {
            if (!canRun) return true;
            onRunAndAdvance();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            if (!canRun) return true;
            onRun();
            return true;
          },
        },
        {
          key: 'Alt-Enter',
          run: () => {
            if (!canRun) return true;
            onRunAndInsert();
            return true;
          },
        },
      ]),
    ];
  }, [isCode, onRun, onRunAndAdvance, onRunAndInsert, canRun]);

  const prompt = isCode
    ? `In [${isExecuting ? '*' : cell.execution_count ?? ' '}]:`
    : cell.cell_type === 'markdown'
    ? 'Markdown'
    : 'Raw';

  return (
    <div
      onClick={onSelect}
      className={`notebook-cell ${isActive ? 'is-active' : ''} ${
        isExecuting ? 'is-executing' : ''
      }`}
    >
      <div className="notebook-cell__prompt" title={`Cell #${index + 1}`}>
        {prompt}
      </div>

      <div className="notebook-cell__body">
        <div className="notebook-cell__tools">
          <div className="notebook-cell__type-switch">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onTypeChange('code');
              }}
              className={`notebook-cell__type-button ${
                isCode ? 'is-selected' : ''
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
              className={`notebook-cell__type-button ${
                cell.cell_type === 'markdown' ? 'is-selected' : ''
              }`}
            >
              <FileText size={13} />
              Markdown
            </button>
          </div>

          <div className="notebook-cell__actions">
            {isCode && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  if (!canRun) return;
                  onRun();
                }}
                disabled={isExecuting || !canRun}
                title={canRun ? 'Run Cell (Ctrl/Cmd+Enter)' : 'Kernel is not ready'}
                className="notebook-cell__action notebook-cell__action--run"
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

            <span className="notebook-cell__divider" />

            <button
              onClick={(event) => {
                event.stopPropagation();
                onMoveUp();
              }}
              disabled={!canMoveUp}
              title="Move Cell Up"
              className="notebook-cell__action"
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
              className="notebook-cell__action"
            >
              <ChevronDown size={15} />
            </button>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              title="Delete Cell"
              className="notebook-cell__action notebook-cell__action--danger"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <div className="notebook-cell__editor">
          <CodeMirror
            value={sourceText}
            extensions={extensions}
            onChange={(value) => onChange(value)}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: isActive,
              autocompletion: true,
              bracketMatching: true,
            }}
            className="notebook-codemirror"
          />
        </div>

        {isCode && cell.outputs && cell.outputs.length > 0 && (
          <CellOutputView outputs={cell.outputs} />
        )}
      </div>
    </div>
  );
};
