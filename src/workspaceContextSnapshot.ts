import type { AgentChatContext } from './types/agent';

export interface WorkspaceContextSnapshotRef {
  current: AgentChatContext;
}

export function storeWorkspaceContextSnapshot(
  ref: WorkspaceContextSnapshotRef,
  context: AgentChatContext
): void {
  const prev = ref.current;
  if (
    prev &&
    prev.notebook_path &&
    context.notebook_path === prev.notebook_path &&
    (context.server_id === undefined || context.server_id === prev.server_id)
  ) {
    const needsMerge =
      (context.server_id === undefined && prev.server_id !== undefined) ||
      (context.kernel_id === undefined && prev.kernel_id !== undefined) ||
      (context.session_id === undefined && prev.session_id !== undefined) ||
      (context.active_cell_id === undefined && prev.active_cell_id !== undefined);

    if (needsMerge) {
      ref.current = {
        ...prev,
        ...context,
        server_id: context.server_id ?? prev.server_id,
        kernel_id: context.kernel_id ?? prev.kernel_id,
        session_id: context.session_id ?? prev.session_id,
        active_cell_id: context.active_cell_id ?? prev.active_cell_id,
      };
      return;
    }
  }
  ref.current = context;
}

export function readWorkspaceContextSnapshot(
  ref: WorkspaceContextSnapshotRef
): AgentChatContext {
  return ref.current;
}
