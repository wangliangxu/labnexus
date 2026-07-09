import type { AgentChatContext } from './types/agent';

export interface WorkspaceContextSnapshotRef {
  current: AgentChatContext;
}

export function storeWorkspaceContextSnapshot(
  ref: WorkspaceContextSnapshotRef,
  context: AgentChatContext
): void {
  ref.current = context;
}

export function readWorkspaceContextSnapshot(
  ref: WorkspaceContextSnapshotRef
): AgentChatContext {
  return ref.current;
}
