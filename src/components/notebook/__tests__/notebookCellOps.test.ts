import {
  createNotebookCell,
  prepareRunCellExecutionState,
  resolveRunModeTransition,
  updateCellSourceSnapshot,
} from '../notebookCellOps.ts';
import type { Cell } from '../../../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeCell(id: string): Cell {
  return {
    id,
    cell_type: 'code',
    source: '',
    outputs: [],
    execution_count: null,
    metadata: {},
  };
}

const cells = [makeCell('a'), makeCell('b')];

const stay = resolveRunModeTransition(cells, 0, 'stay');
assert(stay.activeCellIndex === 0, 'stay keeps active cell');
assert(stay.cells.length === 2, 'stay does not add a cell');

const advanceMiddle = resolveRunModeTransition(cells, 0, 'advance');
assert(advanceMiddle.activeCellIndex === 1, 'advance selects next cell');
assert(advanceMiddle.cells.length === 2, 'advance in middle does not add a cell');

const advanceEnd = resolveRunModeTransition(cells, 1, 'advance');
assert(advanceEnd.activeCellIndex === 2, 'advance at end selects inserted cell');
assert(advanceEnd.cells.length === 3, 'advance at end inserts a cell');
assert(advanceEnd.cells[2].cell_type === 'code', 'advance inserts a code cell');

const insert = resolveRunModeTransition(cells, 0, 'insert');
assert(insert.activeCellIndex === 1, 'insert selects inserted cell');
assert(insert.cells.length === 3, 'insert adds a cell below current');
assert(
  insert.cells[0].id === 'a' && insert.cells[2].id === 'b',
  'insert preserves surrounding cell order'
);

const markdown = createNotebookCell('markdown');
assert(markdown.cell_type === 'markdown', 'createNotebookCell supports markdown');
assert(markdown.outputs.length === 0, 'new cells start with no outputs');

const cellWithOutput: Cell = {
  ...makeCell('with-output'),
  outputs: [{ output_type: 'stream', name: 'stdout', text: 'old\n' } as any],
};
const preparedStay = prepareRunCellExecutionState([cellWithOutput], 0, 'stay');
assert(preparedStay.cells.length === 1, 'preparing stay mode does not add a cell');
assert(preparedStay.cells[0].outputs?.length === 0, 'preparing execution clears only the target cell outputs');
assert(preparedStay.activeCellIndex === 0, 'preparing stay mode keeps the active cell');

const preparedInsert = prepareRunCellExecutionState(cells, 0, 'insert');
assert(preparedInsert.cells.length === 3, 'preparing insert mode adds a cell before execution is sent');
assert(preparedInsert.activeCellIndex === 1, 'preparing insert mode selects the inserted cell');

const sourceSnapshot = { current: cells };
const updatedSourceCells = updateCellSourceSnapshot(sourceSnapshot, 'b', 'print("fast")');
assert(sourceSnapshot.current === updatedSourceCells, 'source snapshot points at the latest cells array');
assert(updatedSourceCells[1].source === 'print("fast")', 'source snapshot updates the edited cell source');
assert(updatedSourceCells[0] === cells[0], 'source snapshot preserves untouched cell objects');
assert(updatedSourceCells !== cells, 'source snapshot update does not mutate the original cells array');
