import type { ConnectionStatus } from './types/jupyter';

export type ViewMode = 'connect' | 'explore';

export function resolveServerSelectionViewMode(
  currentViewMode: ViewMode,
  status: ConnectionStatus
): ViewMode {
  if (status === 'connecting' || status === 'reconnecting') {
    return currentViewMode;
  }

  return 'explore';
}
