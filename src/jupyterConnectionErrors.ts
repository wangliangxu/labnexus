export interface JupyterConnectionErrorRecovery {
  canReconnect: boolean;
  restartUrl?: string;
}

export function normalizeJupyterConnectionErrorMessage(error: string): string {
  const apiPayloadMatch = error.match(/Jupyter API error:\s*\d+\s*—\s*(.+)$/);
  if (!apiPayloadMatch) return error;

  try {
    const payload = JSON.parse(apiPayloadMatch[1]) as { message?: unknown };
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    return error;
  }

  return error;
}

export function getJupyterConnectionErrorRecovery(
  error: string | null
): JupyterConnectionErrorRecovery {
  if (!error) {
    return { canReconnect: false };
  }

  const normalized = normalizeJupyterConnectionErrorMessage(error);
  const restartUrl = normalized.match(
    /Restart the server at (https?:\/\/[^\s"'}]+)/i
  )?.[1];
  const canReconnect =
    /Jupyter API error:\s*424/i.test(error) ||
    /server no longer running/i.test(normalized) ||
    Boolean(restartUrl);

  return {
    canReconnect,
    restartUrl,
  };
}
