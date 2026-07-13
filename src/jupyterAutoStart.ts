import type { JupyterServerConfig, ServerConnection } from './types/jupyter';
import { getJupyterConnectionErrorRecovery } from './jupyterConnectionErrors';

type ConnectServer = (config: JupyterServerConfig) => Promise<ServerConnection>;
type RestartServer = (
  serverId: string,
  restartUrl: string
) => Promise<ServerConnection>;

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Connect once and automatically start a stopped JupyterHub server when the
 * connection error provides its Hub spawn URL.
 */
export async function connectWithStoppedServerAutoStart(
  config: JupyterServerConfig,
  connectServer: ConnectServer,
  restartServer: RestartServer
): Promise<ServerConnection> {
  try {
    return await connectServer(config);
  } catch (error: unknown) {
    const recovery = getJupyterConnectionErrorRecovery(getErrorMessage(error));
    if (!recovery.restartUrl) {
      throw error;
    }

    return restartServer(config.id, recovery.restartUrl);
  }
}
