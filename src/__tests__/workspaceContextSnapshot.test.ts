import type { AgentChatContext } from '../types/agent';
import {
  readWorkspaceContextSnapshot,
  storeWorkspaceContextSnapshot,
  type WorkspaceContextSnapshotRef,
} from '../workspaceContextSnapshot.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ref: WorkspaceContextSnapshotRef = { current: {} };
let appStateUpdates = 0;
const setAppState = () => {
  appStateUpdates += 1;
};

const firstContext: AgentChatContext = {
  notebook_path: 'analysis.ipynb',
  active_cell_index: 0,
  active_cell_code: 'print("a")',
};

storeWorkspaceContextSnapshot(ref, firstContext);
assert(
  readWorkspaceContextSnapshot(ref) === firstContext,
  'workspace context snapshot returns the latest object'
);
assert(appStateUpdates === 0, 'snapshot updates do not require App state updates');

const nextContext: AgentChatContext = {
  ...firstContext,
  active_cell_code: 'print("ab")',
};

storeWorkspaceContextSnapshot(ref, nextContext);
assert(
  readWorkspaceContextSnapshot(ref).active_cell_code === 'print("ab")',
  'workspace context snapshot keeps the newest active cell code'
);

setAppState();
assert(appStateUpdates === 1, 'test harness detects state updates when invoked');

const fullContext: AgentChatContext = {
  server_id: 'srv-1',
  notebook_path: 'analysis.ipynb',
  session_id: 'sess-1',
  kernel_id: 'kern-1',
  active_cell_id: 'cell-1',
  active_cell_index: 0,
  active_cell_code: 'x = 1',
  kernel_status: 'idle',
};
storeWorkspaceContextSnapshot(ref, fullContext);
storeWorkspaceContextSnapshot(ref, {
  notebook_path: 'analysis.ipynb',
  active_cell_index: 0,
  active_cell_code: 'x = 2',
  kernel_status: 'idle',
});
const merged = readWorkspaceContextSnapshot(ref);
assert(merged.server_id === 'srv-1', 'partial update preserves server_id');
assert(merged.kernel_id === 'kern-1', 'partial update preserves kernel_id');
assert(merged.session_id === 'sess-1', 'partial update preserves session_id');
assert(merged.active_cell_id === 'cell-1', 'partial update preserves active_cell_id');
assert(merged.active_cell_code === 'x = 2', 'partial update updates active_cell_code');

