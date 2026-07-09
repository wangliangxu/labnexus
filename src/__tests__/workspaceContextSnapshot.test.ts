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
