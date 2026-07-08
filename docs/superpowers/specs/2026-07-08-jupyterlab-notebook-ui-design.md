# JupyterLab-Style Notebook Runtime UI Design

## Context

LabNexus currently renders notebooks through a compact React/Tauri stack:

- `src/components/notebook/NotebookEditor.tsx` owns notebook loading, saving, active cell state, cell mutation, and execution orchestration.
- `src/components/notebook/NotebookToolbar.tsx` renders notebook actions and kernel status.
- `src/components/notebook/CellEditor.tsx` renders each cell with CodeMirror, per-cell actions, and keyboard shortcuts.
- `src/components/notebook/CellOutputView.tsx` renders Jupyter output payloads.
- `src/hooks/useKernel.ts` manages Jupyter sessions, WebSocket messages, execution requests, interrupt, and restart.

The current notebook UI uses dark card-like cells and per-cell headers. It supports basic run, run all, save, add, interrupt, restart, and `Shift+Enter` / `Mod+Enter`, but `Shift+Enter` and `Mod+Enter` both currently run and advance because they share the same `onRun` callback.

## Goal

Adjust the notebook runtime interface so it behaves and looks closer to JupyterLab while keeping the existing architecture and backend integration intact.

Success means:

- The notebook page reads visually as a JupyterLab-like notebook document, not as stacked dark cards.
- The primary run controls match common JupyterLab expectations.
- Keyboard behavior distinguishes run-only from run-and-advance.
- Kernel status, dirty state, active cell, execution prompt, and output placement are easy to scan.
- Changes remain focused in the notebook frontend components and do not require backend protocol changes.

## Scope

In scope:

- Restyle the notebook toolbar into a compact JupyterLab-like action strip.
- Restyle notebook cells into prompt + editor/output rows.
- Add explicit execution modes:
  - run selected cell
  - run selected cell and advance
  - run selected cell and insert below
  - run all code cells
- Align shortcuts:
  - `Shift+Enter`: run selected cell and advance, creating a new cell at the bottom if needed.
  - `Mod+Enter`: run selected cell without moving selection.
  - `Alt+Enter`: run selected cell and insert a new code cell below.
  - `Mod+S`: save notebook.
- Preserve markdown/code type switching and add cell actions.
- Keep output rendering support for stream, HTML, images, plain text, and errors.

Out of scope:

- Full JupyterLab command mode state machine.
- Full command-mode shortcuts such as `A`, `B`, `DD`, `Y`, `M`.
- Clipboard-level cell cut/copy/paste.
- Backend Jupyter protocol changes.
- New package dependencies.

## Proposed Approach

Use a focused frontend refactor that keeps the existing component boundaries:

1. Update `NotebookEditor` to expose separate run modes instead of a single `handleRunCell`.
2. Update `CellEditor` to accept separate callbacks for run-only, run-and-advance, and run-and-insert shortcuts.
3. Update `NotebookToolbar` to run the selected cell by default and offer JupyterLab-style controls.
4. Add a notebook-specific CSS file or notebook CSS section with stable class names instead of relying on dense utility-class styling.
5. Keep `useKernel` unchanged unless implementation reveals a clear execution-state bug.

This balances fidelity and risk: the UI and interaction model become much closer to JupyterLab without turning the notebook editor into a new application inside the app.

## Component Design

### `NotebookEditor`

Responsibilities remain:

- Load and save notebook content.
- Track active cell index.
- Track the currently executing cell id.
- Mutate cells for add, delete, move, type change, and source change.
- Bridge kernel execution callbacks into cell outputs and execution counts.

New/changed behavior:

- `runCell(index, mode)` accepts:
  - `stay`: run without changing selection.
  - `advance`: run and select the next cell, adding a code cell if the selected cell is the last cell.
  - `insert`: run and insert a new code cell directly below the selected cell.
- Toolbar Run calls `runCell(activeCellIndex, 'stay')`.
- Toolbar Run All executes code cells in order.
- Adding a cell from the toolbar inserts below the active cell and selects the new cell.

### `NotebookToolbar`

The toolbar becomes a compact notebook action strip:

- Left cluster: save, add code cell, add markdown cell.
- Run cluster: run selected cell, interrupt, restart, run all.
- Cell type selector: shows and changes the active cell type.
- Right cluster: notebook name, dirty indicator, kernel display name, kernel status.

Button labels are short and tooltips carry detail. Icons come from `lucide-react`.

### `CellEditor`

The cell layout becomes:

- A fixed-width prompt gutter on the left:
  - Code cells show `In [ ]:`, `In [*]:`, or `In [n]:`.
  - Markdown cells show `Markdown`.
- The editor/output column on the right:
  - CodeMirror is shown without a heavy card wrapper.
  - Outputs sit directly below the editor in the same cell row.
  - Active cells use a blue left accent and a subtle border.

Keyboard handling:

- `Shift+Enter` calls run-and-advance.
- `Mod+Enter` calls run-only.
- `Alt+Enter` calls run-and-insert.

### `CellOutputView`

Output rendering remains data-compatible with the current implementation but shifts visually toward JupyterLab:

- Stream and plain text output use light backgrounds and monospace text.
- HTML output uses a plain bordered output area that allows tables to scroll horizontally.
- Image output uses a clean output area without dark framed cards.
- Error output uses a red-tinted block with readable traceback.

## Data Flow

The existing data flow remains:

1. `NotebookEditor` loads `.ipynb` content through `jupyterGetContent`.
2. Cells are rendered by `CellEditor`.
3. Run actions call `kernel.executeCell(cellId, source)`.
4. `useKernel` maps kernel messages back to cell ids.
5. Output callbacks append outputs to the matching cell.
6. Completion callbacks update execution count and clear the running marker.
7. Save serializes notebook cells back through `jupyterSaveContent`.

## Error Handling

- If the kernel is not ready, run buttons are disabled and shortcuts become no-ops.
- If execution send fails, `useKernel` already calls completion cleanup and sets `kernel.error`; the notebook banner continues to show that error.
- Restart clears pending execution state through the existing hook behavior.
- Deleting the active or executing cell keeps the active index within bounds.

## Testing

Because the project currently has no test files or test runner dependency, verification should use the available build pipeline first:

- Run `npm run build` after implementation.
- If introducing test infrastructure is acceptable later, add focused tests around notebook run-mode state transitions.

Manual verification should cover:

- `Shift+Enter` runs and advances.
- `Mod+Enter` runs and stays.
- `Alt+Enter` runs and inserts below.
- Toolbar Run runs the selected cell.
- Run All executes cells in order.
- Active cell indicator, execution prompt, outputs, kernel status, and dirty indicator render correctly.

## Risks

- `Run All` currently awaits only message send, not execution completion. Preserving that behavior avoids backend changes but means cells may be queued quickly. This matches Jupyter's ability to queue execution requests, but it should be checked manually.
- Light notebook styling sits inside the app's dark IDE shell. The notebook surface should therefore use its own scoped CSS to avoid theme bleed and text contrast issues.
- JupyterLab visual fidelity is intentionally partial. Full command mode and clipboard behavior are deferred.
