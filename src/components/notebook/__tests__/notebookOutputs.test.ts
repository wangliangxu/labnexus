import { appendCellOutputs, applyPendingOutputs } from '../notebookOutputs.ts';
import type { Cell, CellOutput } from '../../../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const stdout = (text: string): CellOutput => ({ output_type: 'stream', name: 'stdout', text });

const merged = appendCellOutputs([stdout('a')], [stdout('b'), stdout('c')], '[cut]');
assert(merged.length === 1, 'merges consecutive stdout chunks');
assert((merged[0] as { text: string }).text === 'abc', 'preserves stream order');

const mixed = appendCellOutputs(
  [],
  [stdout('a'), { output_type: 'stream', name: 'stderr', text: 'e' }, stdout('b')],
  '[cut]'
);
assert(mixed.length === 3, 'does not merge different stream names');

let capped: CellOutput[] = [];
for (let i = 0; i < 50; i += 1) capped = appendCellOutputs(capped, [stdout('0123456789')], '[cut]', 25);
const cappedText = (capped[0] as { text: string }).text;
assert(cappedText.startsWith('[cut]\n'), 'marks truncated output');
assert(cappedText.length === '[cut]\n'.length + 25, 'keeps only the newest characters');
assert(cappedText.split('[cut]').length === 2, 'marker never accumulates');

const cells = [
  { id: 'x', cell_type: 'code', source: '', outputs: [] },
  { id: 'y', cell_type: 'code', source: '', outputs: [] },
] as unknown as Cell[];
const next = applyPendingOutputs(cells, new Map([['y', [stdout('hi')]]]), '[cut]');
assert(next[0] === cells[0], 'untouched cells keep identity for memoized rendering');
assert(next[1].outputs?.length === 1, 'pending outputs are applied');

console.log('notebookOutputs tests passed');
