import type { Cell, CellOutput } from '../../types/jupyter';

/** Keep at most this many characters per consecutive stream output. */
export const MAX_STREAM_CHARS = 200_000;

function streamText(text: string | string[]): string {
  return typeof text === 'string' ? text : text.join('');
}

function capStream(text: string, maxChars: number, marker: string): string {
  if (text.length <= maxChars) return text;
  const markerLine = `${marker}\n`;
  // Drop the previous marker (if any) before re-truncating, so markers never accumulate.
  const body = text.startsWith(markerLine) ? text.slice(markerLine.length) : text;
  return markerLine + body.slice(body.length - maxChars);
}

/**
 * Append kernel outputs to a cell's outputs. Consecutive stream outputs with the same
 * name are merged, and merged stream text is capped to the most recent `maxChars`.
 */
export function appendCellOutputs(
  current: CellOutput[],
  incoming: CellOutput[],
  marker: string,
  maxChars = MAX_STREAM_CHARS
): CellOutput[] {
  const outputs = current.slice();
  for (const output of incoming) {
    const last = outputs[outputs.length - 1];
    if (
      output.output_type === 'stream' &&
      last?.output_type === 'stream' &&
      last.name === output.name
    ) {
      outputs[outputs.length - 1] = {
        ...last,
        text: capStream(streamText(last.text) + streamText(output.text), maxChars, marker),
      };
    } else if (output.output_type === 'stream') {
      outputs.push({ ...output, text: capStream(streamText(output.text), maxChars, marker) });
    } else {
      outputs.push(output);
    }
  }
  return outputs;
}

/** Apply all pending per-cell outputs in one pass over the cell list. */
export function applyPendingOutputs(
  cells: Cell[],
  pending: Map<string, CellOutput[]>,
  marker: string,
  maxChars = MAX_STREAM_CHARS
): Cell[] {
  if (pending.size === 0) return cells;
  return cells.map((cell) => {
    const incoming = cell.id ? pending.get(cell.id) : undefined;
    if (!incoming || incoming.length === 0) return cell;
    return { ...cell, outputs: appendCellOutputs(cell.outputs || [], incoming, marker, maxChars) };
  });
}
