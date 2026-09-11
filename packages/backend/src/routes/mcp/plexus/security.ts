import { McpToolError, type ToolInput } from './types';

export const DESTRUCTIVE_OPERATIONS = new Set([
  'delete',
  'delete_all',
  'clear',
  'clear_for_key',
  'quota_clear',
  'delete_log',
  'delete_all_logs',
  'disable',
  'restore',
  'restart',
  'rotate',
  'truncate',
  'import',
  'overwrite',
]);

export function requireDestructiveAck(input: ToolInput) {
  if (input.destructive !== 'acknowledged') {
    throw new McpToolError(
      'This destructive operation requires destructive: "acknowledged".',
      'confirmation_required',
      400
    );
  }
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      if (isSensitiveKey(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, redactSecrets(nested)];
    })
  );
}

export function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized === 'secret' ||
    normalized === 'api_key' ||
    normalized === 'apikey' ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized.includes('token') ||
    normalized.includes('session') ||
    normalized.includes('password') ||
    normalized.includes('authcookie') ||
    normalized.includes('managementapikey')
  );
}
