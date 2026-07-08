import type { ServerConnection } from '../types/jupyter';

export function markServerConnectionError(
  servers: ServerConnection[],
  serverId: string,
  message: string
): ServerConnection[] {
  return servers.map((server) =>
    server.config.id === serverId
      ? {
          ...server,
          status: 'error',
          error_message: message,
        }
      : server
  );
}
