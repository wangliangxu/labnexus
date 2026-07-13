import { connectWithStoppedServerAutoStart } from '../jupyterAutoStart';
import type { JupyterServerConfig, ServerConnection } from '../types/jupyter';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const config: JupyterServerConfig = {
  id: 'server-1',
  name: 'Remote',
  base_url: 'https://example.test/user/me',
  token: 'token',
};
const connected: ServerConnection = {
  config,
  status: 'connected',
};
const stoppedError =
  'Jupyter connection error: Jupyter API error: 424 — {"message": "JupyterHub server no longer running. Restart the server at https://example.test/hub/spawn/me"}';

const restartCalls: Array<{ serverId: string; restartUrl: string }> = [];
const recovered = await connectWithStoppedServerAutoStart(
  config,
  async () => {
    throw new Error(stoppedError);
  },
  async (serverId, restartUrl) => {
    restartCalls.push({ serverId, restartUrl });
    return connected;
  }
);

assert(recovered === connected, 'returns the connection after automatically starting the server');
assert(restartCalls[0]?.serverId === config.id, 'restarts the server that failed to connect');
assert(
  restartCalls[0]?.restartUrl === 'https://example.test/hub/spawn/me',
  'uses the spawn URL from the stopped-server error'
);

const unrelatedError = new Error('Jupyter API error: 403 — Forbidden');
let restartedUnrelatedError = false;
try {
  await connectWithStoppedServerAutoStart(
    config,
    async () => {
      throw unrelatedError;
    },
    async () => {
      restartedUnrelatedError = true;
      return connected;
    }
  );
  assert(false, 'unrelated connection errors are rethrown');
} catch (error: unknown) {
  assert(error === unrelatedError, 'preserves unrelated connection errors');
}
assert(!restartedUnrelatedError, 'does not restart for unrelated connection errors');
