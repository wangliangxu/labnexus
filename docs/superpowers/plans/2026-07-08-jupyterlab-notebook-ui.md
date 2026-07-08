# JupyterLab Notebook UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LabNexus notebook runtime UI and core run controls behave more like JupyterLab.

**Architecture:** Keep the existing React/Tauri notebook architecture. Add a small pure helper for run-mode cell state transitions, wire that helper into `NotebookEditor`, then restyle the toolbar, cells, and outputs with scoped notebook CSS.

**Tech Stack:** React 19, TypeScript, Vite, CodeMirror, lucide-react, Tauri IPC.

---

## File Structure

- Create: `src/components/notebook/notebookCellOps.ts`
  - Pure cell creation and active-index transition helpers for notebook run modes.
- Create: `src/components/notebook/__tests__/notebookCellOps.test.ts`
  - Minimal Node-runnable TypeScript test for the pure helper.
- Create: `src/components/notebook/Notebook.css`
  - Scoped JupyterLab-like notebook styles.
- Modify: `src/components/notebook/NotebookEditor.tsx`
  - Run modes, active-cell toolbar wiring, CSS import.
- Modify: `src/components/notebook/NotebookToolbar.tsx`
  - Compact JupyterLab-style toolbar and active cell type selector.
- Modify: `src/components/notebook/CellEditor.tsx`
  - Prompt gutter, separate run callbacks, JupyterLab-like cell structure.
- Modify: `src/components/notebook/CellOutputView.tsx`
  - JupyterLab-like output styling class names.

## Task 1: Add Run-Mode Helper With Failing Test

**Files:**
- Create: `src/components/notebook/__tests__/notebookCellOps.test.ts`
- Create later: `src/components/notebook/notebookCellOps.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/notebook/__tests__/notebookCellOps.test.ts`:

```ts
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
assert(insert.cells[0].id === 'a' && insert.cells[2].id === 'b', 'insert preserves surrounding cell order');

const markdown = createNotebookCell('markdown');
assert(markdown.cell_type === 'markdown', 'createNotebookCell supports markdown');
assert(markdown.outputs.length === 0, 'new cells start with no outputs');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsc --target ES2020 --module commonjs --moduleResolution node --outDir /private/tmp/labnexus-notebook-tests --rootDir src --skipLibCheck --strict src/components/notebook/__tests__/notebookCellOps.test.ts
```

Expected: FAIL because `../notebookCellOps` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/components/notebook/notebookCellOps.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx tsc --target ES2020 --module commonjs --moduleResolution node --outDir /private/tmp/labnexus-notebook-tests --rootDir src --skipLibCheck --strict src/components/notebook/notebookCellOps.ts src/components/notebook/__tests__/notebookCellOps.test.ts
node /private/tmp/labnexus-notebook-tests/components/notebook/__tests__/notebookCellOps.test.js
```

Expected: both commands exit 0.

## Task 2: Wire Run Modes Into NotebookEditor

**Files:**
- Modify: `src/components/notebook/NotebookEditor.tsx`

- [ ] **Step 1: Import helper and CSS**

Add imports:

```ts
import './Notebook.css';
import { createNotebookCell, resolveRunModeTransition, type RunCellMode } from './notebookCellOps';
```

- [ ] **Step 2: Replace duplicate new-cell literals**

Use `createNotebookCell('code')` or `createNotebookCell(type)` for empty notebook initialization and toolbar cell insertion.

- [ ] **Step 3: Replace `handleRunCell(index)` with `handleRunCell(index, mode)`**

Behavior:

```ts
const handleRunCell = async (index: number, mode: RunCellMode = 'stay') => {
  const cell = cells[index];
  if (!cell || cell.cell_type !== 'code' || !canRunCode) return;
  setCells((prev) => prev.map((c, i) => (i === index ? { ...c, outputs: [] } : c)));
  setExecutingCellId(cell.id || null);
  const didSend = await kernel.executeCell(cell.id || '', sourceText);
  if (!didSend) return;
  const transition = resolveRunModeTransition(cells, index, mode);
  setCells(transition.cells);
  setActiveCellIndex(transition.activeCellIndex);
  if (transition.cells !== cells) setIsDirty(true);
};
```

- [ ] **Step 4: Update toolbar and cell callbacks**

Toolbar Run calls `handleRunCell(activeCellIndex, 'stay')`.

Cell shortcuts pass:

```tsx
onRun={() => handleRunCell(idx, 'stay')}
onRunAndAdvance={() => handleRunCell(idx, 'advance')}
onRunAndInsert={() => handleRunCell(idx, 'insert')}
```

## Task 3: Restyle Toolbar, Cell, and Output Components

**Files:**
- Modify: `src/components/notebook/NotebookToolbar.tsx`
- Modify: `src/components/notebook/CellEditor.tsx`
- Modify: `src/components/notebook/CellOutputView.tsx`
- Create: `src/components/notebook/Notebook.css`

- [ ] **Step 1: Update toolbar props**

Add active cell controls:

```ts
activeCellType: CellType;
onActiveCellTypeChange: (type: CellType) => void;
onRunSelected: () => void;
```

Keep save, add, run all, interrupt, restart, connect, and status props.

- [ ] **Step 2: Render compact JupyterLab-style toolbar**

Use scoped classes such as:

```tsx
<div className="notebook-toolbar">
  <div className="notebook-toolbar__group">...</div>
  <select className="notebook-toolbar__select">...</select>
  <div className="notebook-toolbar__spacer" />
  <div className="notebook-kernel-chip">...</div>
</div>
```

- [ ] **Step 3: Update cell layout**

Use prompt gutter and body classes:

```tsx
<div className={`notebook-cell ${isActive ? 'is-active' : ''}`}>
  <div className="notebook-cell__prompt">In [*]:</div>
  <div className="notebook-cell__body">...</div>
</div>
```

- [ ] **Step 4: Update output class names**

Use classes:

```tsx
notebook-output
notebook-output--stream
notebook-output--stderr
notebook-output--rich
notebook-output--image
notebook-output--text
notebook-output--error
```

- [ ] **Step 5: Add scoped CSS**

Create `Notebook.css` with JupyterLab-like light notebook surface, prompt gutter, compact toolbar, selected-cell indicators, and output styling.

## Task 4: Verify Build

**Files:**
- Read: `package.json`

- [ ] **Step 1: Run helper test**

Run:

```bash
npx tsc --target ES2020 --module commonjs --moduleResolution node --outDir /private/tmp/labnexus-notebook-tests --rootDir src --skipLibCheck --strict src/components/notebook/notebookCellOps.ts src/components/notebook/__tests__/notebookCellOps.test.ts
node /private/tmp/labnexus-notebook-tests/components/notebook/__tests__/notebookCellOps.test.js
```

Expected: exit 0.

- [ ] **Step 2: Run project build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 3: If build fails, investigate root cause before patching**

Use `superpowers:systematic-debugging`: read the first TypeScript or Vite error fully, identify the file and reason, then apply the smallest fix and rerun `npm run build`.
