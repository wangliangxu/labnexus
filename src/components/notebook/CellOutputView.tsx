import { t } from '../../i18n';
import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import type { CellOutput } from '../../types/jupyter';
import { renderSanitizedMarkdown, sanitizeRichHtml } from '../../utils/sanitizeHtml';

interface CellOutputViewProps {
  outputs: CellOutput[];
}

function dataToString(value: unknown): string {
  if (Array.isArray(value)) return value.join('');
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return value == null ? '' : String(value);
}

const MAX_COLLAPSED_LINES = 24;
const MAX_COLLAPSED_CHARS = 2400;

/* ── Output class tokens ─────────────────────────────────────────── */
const outBase =
  'm-0 py-2 px-2.5 overflow-x-auto font-mono text-xs leading-relaxed';

const outStream =
  `${outBase} border border-transparent bg-transparent text-nb-text whitespace-pre-wrap`;

const outStderr =
  `${outBase} border border-nb-error-border bg-nb-error text-nb-error-text whitespace-pre-wrap`;

const outText =
  `${outBase} border border-transparent bg-transparent text-nb-text whitespace-pre-wrap`;

const outRich =
  `${outBase} border border-nb-output-border bg-nb-cell text-nb-text max-w-full whitespace-normal notebook-output-rich`;

const outImage =
  `${outBase} border border-nb-output-border flex items-center justify-center bg-nb-cell`;

const outError =
  `${outBase} border border-nb-error-border bg-nb-error text-nb-error-text whitespace-pre-wrap`;

const CollapsibleTextOutput: React.FC<{
  text: string;
  className: string;
  header?: React.ReactNode;
}> = ({ text, className, header }) => {
  const lines = text.split('\n');
  const isLong =
    lines.length > MAX_COLLAPSED_LINES || text.length > MAX_COLLAPSED_CHARS;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayedText =
    isLong && !expanded
      ? lines.slice(0, MAX_COLLAPSED_LINES).join('\n').slice(0, MAX_COLLAPSED_CHARS) +
        '\n…'
      : text;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="relative group/out">
      <button
        type="button"
        onClick={handleCopy}
        title={t('Copy')}
        aria-label={t('Copy')}
        className="opacity-0 group-hover/out:opacity-100 focus:opacity-100 absolute top-1.5 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-nb-output-border bg-nb-cell text-nb-text-secondary hover:text-nb-text transition-opacity"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        <span>{copied ? t('Copied') : t('Copy')}</span>
      </button>
      <pre className={className}>
        {header}
        {displayedText}
      </pre>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-nb-text-secondary hover:text-nb-text transition-colors"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>
            {expanded
              ? t('Collapse output')
              : t('Show full output ({count} lines)', { count: lines.length })}
          </span>
        </button>
      )}
    </div>
  );
};

export const CellOutputView: React.FC<CellOutputViewProps> = ({ outputs }) => {
  if (!outputs || outputs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 mt-1.5">
      {outputs.map((out, index) => {
        if (out.output_type === 'stream') {
          const isErr = out.name === 'stderr';
          return (
            <CollapsibleTextOutput
              key={index}
              text={dataToString(out.text)}
              className={isErr ? outStderr : outStream}
            />
          );
        }

        if (
          out.output_type === 'execute_result' ||
          out.output_type === 'display_data'
        ) {
          const data = out.data || {};

          if (data['text/html']) {
            const htmlContent = sanitizeRichHtml(dataToString(data['text/html']), {
              allowImages: true,
              allowSvg: true,
              allowStyles: true,
            });
            return (
              <div
                key={index}
                className={outRich}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            );
          }

          if (data['image/svg+xml']) {
            const svgContent = sanitizeRichHtml(dataToString(data['image/svg+xml']), {
              allowImages: true,
              allowSvg: true,
              allowStyles: true,
            });
            return (
              <div
                key={index}
                className={outImage}
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
            );
          }

          if (data['text/markdown']) {
            const mdHtml = renderSanitizedMarkdown(dataToString(data['text/markdown']), {
              allowImages: true,
              allowSvg: true,
              allowStyles: false,
            });
            return (
              <div
                key={index}
                className={`${outRich} nb-markdown-rendered`}
                dangerouslySetInnerHTML={{ __html: mdHtml }}
              />
            );
          }

          if (data['image/png']) {
            const base64Png = dataToString(data['image/png']).trim();
            return (
              <div key={index} className={outImage}>
                <img
                  src={`data:image/png;base64,${base64Png}`}
                  alt={t('Plot output')}
                  className="max-w-full max-h-[520px] object-contain"
                />
              </div>
            );
          }

          if (data['image/jpeg']) {
            const base64Jpeg = dataToString(data['image/jpeg']).trim();
            return (
              <div key={index} className={outImage}>
                <img
                  src={`data:image/jpeg;base64,${base64Jpeg}`}
                  alt={t('Plot output')}
                  className="max-w-full max-h-[520px] object-contain"
                />
              </div>
            );
          }

          if (data['application/json']) {
            const jsonText = dataToString(data['application/json']);
            return (
              <CollapsibleTextOutput
                key={index}
                text={jsonText}
                className={outText}
              />
            );
          }

          if (data['text/plain']) {
            const textContent = dataToString(data['text/plain']);
            return (
              <CollapsibleTextOutput
                key={index}
                text={textContent}
                className={outText}
              />
            );
          }
        }

        if (out.output_type === 'error') {
          const traceback = out.traceback
            ? out.traceback.join('\n')
            : `${out.ename}: ${out.evalue}`;
          const cleanTraceback = traceback.replace(/\x1B\[\d+(;\d+)*m/g, '');
          return (
            <CollapsibleTextOutput
              key={index}
              text={cleanTraceback}
              className={outError}
              header={
                <>
                  <strong>
                    {out.ename}: {out.evalue}
                  </strong>
                  {'\n'}
                </>
              }
            />
          );
        }

        return null;
      })}
    </div>
  );
};
