import { markServerConnectionError } from '../jupyterConnectionState';
import type { ServerConnection } from '../../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const servers: ServerConnection[] = [
  {
    config: {
      id: 'server-1',
      name: 'Remote',
      base_url: 'https://example.test/user/me',
    },
    status: 'connected',
  },
];

const updated = markServerConnectionError(
  servers,
  'server-1',
  'JupyterHub server no longer running'
);

assert(updated[0].status === 'error', 'server is marked error after API disconnect');
assert(
  updated[0].error_message === 'JupyterHub server no longer running',
  'server keeps disconnect error message'
);
assert(
  servers[0].status === 'connected',
  'server list update does not mutate previous state'
);
