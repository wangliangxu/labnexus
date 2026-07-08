import {
  removeSavedServer,
  toDisconnectedConnections,
  upsertSavedServer,
} from '../jupyterServerStorage';
import type { JupyterServerConfig } from '../../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const first: JupyterServerConfig = {
  id: 'server-1',
  name: 'Lab',
  base_url: 'http://localhost:8888',
  token: 'token-a',
};

const updated: JupyterServerConfig = {
  id: 'server-1',
  name: 'Lab Updated',
  base_url: 'http://localhost:9999',
  token: 'token-b',
};

const second: JupyterServerConfig = {
  id: 'server-2',
  name: 'Remote',
  base_url: 'https://example.test/user/me',
  proxy: {
    proxy_type: 'socks5',
    host: '127.0.0.1',
    port: 1080,
  },
};

const inserted = upsertSavedServer([], first);
assert(inserted.length === 1, 'upsert inserts first server');
assert(inserted[0].token === 'token-a', 'upsert preserves token auth token');

const replaced = upsertSavedServer(inserted, updated);
assert(replaced.length === 1, 'upsert replaces matching server id');
assert(replaced[0].name === 'Lab Updated', 'upsert stores latest display name');
assert(replaced[0].token === 'token-b', 'upsert stores latest token');

const appended = upsertSavedServer(replaced, second);
assert(appended.length === 2, 'upsert appends new server id');

const connections = toDisconnectedConnections(appended);
assert(connections.length === 2, 'restores each saved server as a connection');
assert(
  connections.every((connection) => connection.status === 'disconnected'),
  'restored saved servers start disconnected'
);
assert(
  connections[1].config.proxy?.proxy_type === 'socks5',
  'restored saved servers preserve proxy settings'
);

const removed = removeSavedServer(appended, 'server-1');
assert(removed.length === 1, 'remove deletes matching server id');
assert(removed[0].id === 'server-2', 'remove keeps other saved servers');
