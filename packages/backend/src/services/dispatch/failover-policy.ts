export function isRetryableStatus(statusCode: number, retryableStatusCodes: number[]): boolean {
  return retryableStatusCodes.includes(statusCode);
}

/** Determines whether an OAuth failure is safe to retry on another target. */
export function isRetryableOAuthError(error: any): boolean {
  if (!error) return false;

  const errorMessage = error.message?.toLowerCase() || '';
  const statusCode = error.status || error.statusCode;

  if (!statusCode || (statusCode >= 500 && statusCode < 600) || statusCode === 429) {
    return true;
  }

  return [
    'timeout',
    'econnrefused',
    'ECONNREFUSED',
    'etimedout',
    'ETIMEDOUT',
    'network',
    'socket',
    'temporary',
    'unavailable',
    'service unavailable',
  ].some((pattern) => errorMessage.includes(pattern));
}

/** Matches a transport failure against the configured retryable error tokens. */
export function isRetryableNetworkError(error: any, retryableErrors: string[]): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '').toUpperCase();
  return retryableErrors.some((token) => {
    const normalized = token.toUpperCase();
    return code.includes(normalized) || message.includes(normalized);
  });
}
