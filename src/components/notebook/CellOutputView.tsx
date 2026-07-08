import React from 'react';
import type { CellOutput } from '../../types/jupyter';

interface CellOutputViewProps {
  outputs: CellOutput[];
}

function dataToString(value: unknown): string {
  if (Array.isArray(value)) return value.join('');
  return value == null ? '' : String(value);
}

export const CellOutputView: React.FC<CellOutputViewProps> = ({ outputs }) => {
  if (!outputs || outputs.length === 0) return null;

  return (
    <div className="notebook-outputs">
      {outputs.map((out, index) => {
        if (out.output_type === 'stream') {
          const isErr = out.name === 'stderr';
          return (
            <pre
              key={index}
              className={`notebook-output notebook-output--stream ${
                isErr ? 'notebook-output--stderr' : ''
              }`}
            >
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
                className="notebook-output notebook-output--rich"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            );
          }

          if (data['image/png']) {
            const base64Png = dataToString(data['image/png']);
            return (
              <div key={index} className="notebook-output notebook-output--image">
                <img src={`data:image/png;base64,${base64Png}`} alt="Plot output" />
              </div>
            );
          }

          if (data['image/jpeg']) {
            const base64Jpeg = dataToString(data['image/jpeg']);
            return (
              <div key={index} className="notebook-output notebook-output--image">
                <img
                  src={`data:image/jpeg;base64,${base64Jpeg}`}
                  alt="Plot output"
                />
              </div>
            );
          }

          if (data['text/plain']) {
            const textContent = dataToString(data['text/plain']);
            return (
              <pre key={index} className="notebook-output notebook-output--text">
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
            <pre key={index} className="notebook-output notebook-output--error">
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
