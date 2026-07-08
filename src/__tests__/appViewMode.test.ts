import { resolveServerSelectionViewMode } from '../appViewMode';
import type { ConnectionStatus } from '../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  resolveServerSelectionViewMode('connect', 'connected') === 'explore',
  'selecting a connected saved server shows explorer content'
);

assert(
  resolveServerSelectionViewMode('connect', 'disconnected') === 'explore',
  'selecting a disconnected saved server switches to explorer while reconnecting'
);

assert(
  resolveServerSelectionViewMode('connect', 'error') === 'explore',
  'retrying an errored saved server switches to explorer while reconnecting'
);

const transientStatuses: ConnectionStatus[] = ['connecting', 'reconnecting'];
for (const status of transientStatuses) {
  assert(
    resolveServerSelectionViewMode('connect', status) === 'connect',
    `${status} server selection preserves current view`
  );
}
