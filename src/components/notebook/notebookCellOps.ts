import type { Cell, CellType } from '../../types/jupyter';

export type RunCellMode = 'stay' | 'advance' | 'insert';

export interface RunModeTransition {
  cells: Cell[];
  activeCellIndex: number;
}

export function createNotebookCell(type: CellType = 'code'): Cell {
  return {
    id: `cell-${Date.now()}-${crypto.randomUUID()}`,
    cell_type: type,
    source: '',
    outputs: [],
    execution_count: null,
    metadata: {},
  };
}

export function resolveRunModeTransition(
  cells: Cell[],
  index: number,
  mode: RunCellMode
): RunModeTransition {
  if (mode === 'stay') {
    return { cells, activeCellIndex: index };
  }

  if (mode === 'insert') {
    const insertIndex = index + 1;
    const newCell = createNotebookCell('code');
    return {
      cells: [...cells.slice(0, insertIndex), newCell, ...cells.slice(insertIndex)],
      activeCellIndex: insertIndex,
    };
  }

  if (index < cells.length - 1) {
    return { cells, activeCellIndex: index + 1 };
  }

  const newCell = createNotebookCell('code');
  return {
    cells: [...cells, newCell],
    activeCellIndex: cells.length,
  };
}
