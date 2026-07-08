import { createNotebookCell, resolveRunModeTransition } from '../notebookCellOps';
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
