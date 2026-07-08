import React from 'react';
import type { CellOutput } from '../../types/jupyter';

interface CellOutputViewProps {
  outputs: CellOutput[];
}

function dataToString(value: unknown): string {
  if (Array.isArray(value)) return value.join('');
  return value == null ? '' : String(value);
}

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

export const CellOutputView: React.FC<CellOutputViewProps> = ({ outputs }) => {
  if (!outputs || outputs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 mt-1.5">
      {outputs.map((out, index) => {
        if (out.output_type === 'stream') {
          const isErr = out.name === 'stderr';
          return (
            <pre key={index} className={isErr ? outStderr : outStream}>
              {dataToString(out.text)}
            </pre>
          );
        }

        if (
          out.output_type === 'execute_result' ||
          out.output_type === 'display_data'
        ) {
          const data = out.data;

          if (data['text/html']) {
            const htmlContent = dataToString(data['text/html']);
            return (
              <div
                key={index}
                className={outRich}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            );
          }

          if (data['image/png']) {
            const base64Png = dataToString(data['image/png']);
            return (
              <div key={index} className={outImage}>
                <img
                  src={`data:image/png;base64,${base64Png}`}
                  alt="Plot output"
                  className="max-w-full max-h-[520px] object-contain"
                />
              </div>
            );
          }

          if (data['image/jpeg']) {
            const base64Jpeg = dataToString(data['image/jpeg']);
            return (
              <div key={index} className={outImage}>
                <img
                  src={`data:image/jpeg;base64,${base64Jpeg}`}
                  alt="Plot output"
                  className="max-w-full max-h-[520px] object-contain"
                />
              </div>
            );
          }

          if (data['text/plain']) {
            const textContent = dataToString(data['text/plain']);
            return (
              <pre key={index} className={outText}>
                {textContent}
              </pre>
            );
          }
        }

        if (out.output_type === 'error') {
          const traceback = out.traceback
            ? out.traceback.join('\n')
            : `${out.ename}: ${out.evalue}`;
          const cleanTraceback = traceback.replace(/\x1B\[\d+(;\d+)*m/g, '');
          return (
            <pre key={index} className={outError}>
              <strong>
                {out.ename}: {out.evalue}
              </strong>
              {'\n'}
              {cleanTraceback}
            </pre>
          );
        }

        return null;
      })}
    </div>
  );
};
