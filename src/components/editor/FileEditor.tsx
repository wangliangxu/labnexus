import React, { useState, useEffect, useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import {
  Save,
  Loader2,
  AlertTriangle,
  Eye,
  Code2,
  WrapText,
  Wand2,
  RefreshCw,
} from 'lucide-react';
import { t, useLocale } from '../../i18n';
import { jupyterGetContent, jupyterSaveContent } from '../../services/tauriIpc';
import { renderSanitizedMarkdown, sanitizeSvgFragment } from '../../utils/sanitizeHtml';

interface FileEditorProps {
  path: string;
  serverId?: string;
  isActiveTab?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}

type FileLanguage = 'python' | 'json' | 'markdown' | 'svg' | 'text';

function detectFileLanguage(path: string, mimetype?: string): FileLanguage {
  const lower = path.toLowerCase();
  if (lower.endsWith('.py') || lower.endsWith('.pyi') || mimetype === 'text/x-python') {
    return 'python';
  }
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.ipynb') ||
    lower.endsWith('.geojson') ||
    mimetype === 'application/json'
  ) {
    return 'json';
  }
  if (
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    mimetype === 'text/markdown'
  ) {
    return 'markdown';
  }
  if (lower.endsWith('.svg') || mimetype === 'image/svg+xml') {
    return 'svg';
  }
  return 'text';
}

function isBinaryImageFile(path: string, mimetype?: string, format?: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return false;
  if (mimetype && mimetype.startsWith('image/')) return true;
  if (format === 'base64') {
    return /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(lower);
  }
  return /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(lower);
}

function createEditorTheme(dark: boolean) {
  return [
    EditorView.theme(
      {
        '&': {
          backgroundColor: 'var(--color-nb-editor)',
          color: 'var(--color-nb-text)',
          height: '100%',
        },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          lineHeight: '1.55',
        },
        '.cm-content': { caretColor: 'var(--text-primary)', padding: '12px 0' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-primary)' },
        '.cm-gutters': {
          backgroundColor: 'var(--color-nb-gutter)',
          color: 'var(--color-nb-gutter-text)',
          borderRight: '1px solid var(--color-nb-editor-border)',
        },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--bg-active)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
          {
            backgroundColor: 'var(--bg-selected)',
          },
      },
      { dark }
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: 'bold' },
        { tag: [tags.atom, tags.bool, tags.null], color: 'var(--syntax-atom)' },
        { tag: tags.number, color: 'var(--syntax-number)' },
        {
          tag: [tags.definition(tags.variableName), tags.function(tags.variableName)],
          color: 'var(--syntax-def)',
        },
        { tag: [tags.string, tags.regexp], color: 'var(--syntax-string)' },
        { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
        { tag: [tags.meta, tags.annotation], color: 'var(--syntax-meta)' },
        { tag: tags.heading, color: 'var(--text-link)', fontWeight: 'bold' },
        { tag: tags.link, color: 'var(--text-link)', textDecoration: 'underline' },
        { tag: tags.strong, fontWeight: 'bold' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.invalid, color: 'var(--color-error)' },
      ])
    ),
  ];
}

const lightTheme = createEditorTheme(false);
const darkTheme = createEditorTheme(true);

const toolbarBtn =
  'inline-flex items-center justify-center gap-1.5 min-h-[26px] px-2.5 ' +
  'border border-transparent rounded-sm bg-transparent ' +
  'text-nb-text-secondary text-xs leading-none whitespace-nowrap ' +
  'hover:border-nb-btn-hover-border hover:bg-nb-btn-hover ' +
  'disabled:opacity-45 disabled:cursor-default transition-colors cursor-pointer';

export const FileEditor: React.FC<FileEditorProps> = ({
  path,
  serverId,
  isActiveTab = true,
  onDirtyChange,
}) => {
  const locale = useLocale();
  const [content, setContent] = useState<string>('');
  const [savedContent, setSavedContent] = useState<string>('');
  const [fileFormat, setFileFormat] = useState<string>('text');
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lineWrap, setLineWrap] = useState<boolean>(true);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const fileName = path.split('/').pop() || path;
  const isDirty = content !== savedContent;
  const isImage = isBinaryImageFile(path, mimeType, fileFormat);
  const language = useMemo(() => detectFileLanguage(path, mimeType), [path, mimeType]);
  const canPreview = language === 'markdown' || language === 'svg';

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkTheme(document.documentElement.getAttribute('data-theme') === 'dark');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const loadFile = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    try {
      const item = await jupyterGetContent(path, serverId);
      const fmt = item.format || 'text';
      setFileFormat(fmt);
      setMimeType(item.mimetype);

      let textContent = '';
      if (typeof item.content === 'string') {
        textContent = item.content;
      } else if (item.content !== null && item.content !== undefined) {
        textContent = JSON.stringify(item.content, null, 2);
      }
      setContent(textContent);
      setSavedContent(textContent);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [path, serverId]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleSave = useCallback(async () => {
    if (isSaving || !isDirty || isImage) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await jupyterSaveContent(
        path,
        {
          type: 'file',
          format: 'text',
          content,
        },
        serverId
      );
      setSavedContent(content);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [content, isDirty, isImage, isSaving, path, serverId]);

  useEffect(() => {
    if (!isActiveTab) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, isActiveTab]);

  const handleFormatJson = useCallback(() => {
    if (language !== 'json') return;
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed, null, 2));
      setSaveError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(`${t('Invalid JSON')}: ${msg}`);
    }
  }, [content, language]);

  const extensions = useMemo(() => {
    const langExt =
      language === 'python'
        ? [python()]
        : language === 'json'
          ? [json()]
          : language === 'markdown'
            ? [markdown()]
            : [];

    return [
      ...langExt,
      ...(lineWrap ? [EditorView.lineWrapping] : []),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void handleSave();
              return true;
            },
          },
        ])
      ),
    ];
  }, [handleSave, language, lineWrap]);

  const renderedPreviewHtml = useMemo(() => {
    if (!showPreview) return '';
    if (language === 'markdown') {
      return renderSanitizedMarkdown(content, {
        allowImages: true,
        allowSvg: true,
        allowStyles: false,
      });
    }
    if (language === 'svg') {
      return sanitizeSvgFragment(content);
    }
    return '';
  }, [content, language, showPreview, locale]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 bg-nb-shell text-nb-text-secondary text-[13px]">
        <Loader2 size={28} className="animate-spin" />
        <span>
          {t('Loading file')} {fileName}...
        </span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 bg-nb-shell text-nb-error-text text-[13px]">
        <AlertTriangle size={40} />
        <div className="max-w-[620px] text-center">
          <h3 className="mb-2 text-nb-text">{t('Failed to Load File')}</h3>
          <p className="m-0 py-2.5 px-3 border border-nb-error-border bg-nb-cell text-nb-error-text font-mono text-xs text-left">
            {loadError}
          </p>
          <button onClick={() => void loadFile()} className={`${toolbarBtn} mt-3`}>
            <RefreshCw size={13} />
            <span>{t('Retry')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden bg-nb-shell text-nb-text">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 min-h-[38px] px-3.5 py-1 border-b border-nb-border bg-nb-toolbar shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-nb-text truncate" title={path}>
            {fileName}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-xs bg-nb-badge text-nb-text-muted uppercase">
            {isImage ? 'IMAGE' : language}
          </span>
          {isDirty && (
            <span className="text-[11px] text-warning font-medium">
              • {t('Unsaved changes')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {!isImage && (
            <>
              <button
                type="button"
                className={toolbarBtn}
                onClick={() => void handleSave()}
                disabled={!isDirty || isSaving}
                title={t('Save File (Cmd/Ctrl+S)')}
              >
                {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span>{t('Save')}</span>
              </button>

              <button
                type="button"
                className={toolbarBtn}
                onClick={() => setLineWrap((prev) => !prev)}
                title={t('Toggle Word Wrap')}
              >
                <WrapText size={13} />
                <span>{lineWrap ? t('Wrap: On') : t('Wrap: Off')}</span>
              </button>

              {language === 'json' && (
                <button
                  type="button"
                  className={toolbarBtn}
                  onClick={handleFormatJson}
                  title={t('Format JSON')}
                >
                  <Wand2 size={13} />
                  <span>{t('Format')}</span>
                </button>
              )}

              {canPreview && (
                <button
                  type="button"
                  className={toolbarBtn}
                  onClick={() => setShowPreview((prev) => !prev)}
                  title={showPreview ? t('Show Source') : t('Show Preview')}
                >
                  {showPreview ? <Code2 size={13} /> : <Eye size={13} />}
                  <span>{showPreview ? t('Source') : t('Preview')}</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            className={toolbarBtn}
            onClick={() => void loadFile()}
            title={t('Reload from Disk')}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {saveError && (
        <div className="px-3.5 py-2 border-b border-nb-error-border bg-nb-error text-nb-error-text text-xs">
          {saveError}
        </div>
      )}

      {/* Editor / Preview Body */}
      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        {isImage ? (
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto bg-nb-cell">
            <img
              src={`data:${mimeType || 'image/png'};base64,${content.trim()}`}
              alt={fileName}
              className="max-w-full max-h-full object-contain rounded-xs shadow-xs"
            />
          </div>
        ) : showPreview && canPreview ? (
          <div className="flex-1 overflow-auto p-6 bg-nb-cell">
            <div
              className="nb-md-rendered max-w-[920px] mx-auto"
              dangerouslySetInnerHTML={{ __html: renderedPreviewHtml }}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">
            <CodeMirror
              value={content}
              height="100%"
              className="h-full"
              theme={isDarkTheme ? darkTheme : lightTheme}
              extensions={extensions}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                autocompletion: true,
                bracketMatching: true,
              }}
              onChange={(val) => setContent(val)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
