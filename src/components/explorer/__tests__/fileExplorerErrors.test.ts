import {
  getExplorerErrorRecovery,
  normalizeExplorerErrorMessage,
} from '../fileExplorerErrors';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const stoppedHubServerError =
  'Jupyter API error: 424 — {"message": "JupyterHub server no longer running at /user/wlx/api/contents/bike. Restart the server at https://ius16.dataincity.com/hub/spawn/wlx"}';

const recovery = getExplorerErrorRecovery(stoppedHubServerError);
assert(recovery.canReconnect, '424 stopped JupyterHub server error can reconnect');
assert(
  recovery.restartUrl === 'https://ius16.dataincity.com/hub/spawn/wlx',
  'restart URL is extracted from JupyterHub stopped-server error'
);

const normalized = normalizeExplorerErrorMessage(stoppedHubServerError);
assert(
  normalized ===
    'JupyterHub server no longer running at /user/wlx/api/contents/bike. Restart the server at https://ius16.dataincity.com/hub/spawn/wlx',
  'JSON API error payload is displayed as its message text'
);

const permissionError = 'Jupyter API error: 403 — {"message":"Forbidden"}';
assert(
  !getExplorerErrorRecovery(permissionError).canReconnect,
  'unrelated API errors do not show reconnect action'
);

const nestedConnectionError =
  'Jupyter connection error: Jupyter API error: 424 — {"message": "JupyterHub server no longer running at /user/wlx/api. Restart the server at https://ius16.dataincity.com/hub/spawn/wlx"}';

assert(
  normalizeExplorerErrorMessage(nestedConnectionError) ===
    'JupyterHub server no longer running at /user/wlx/api. Restart the server at https://ius16.dataincity.com/hub/spawn/wlx',
  'nested connection errors are normalized to the API payload message'
);
assert(
  getExplorerErrorRecovery(nestedConnectionError).restartUrl ===
    'https://ius16.dataincity.com/hub/spawn/wlx',
  'restart URL is extracted from nested reconnect errors'
);
