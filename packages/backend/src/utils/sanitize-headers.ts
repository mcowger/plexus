const SENSITIVE_HEADERS = [
  'authorization',
  'x-admin-key',
  'x-auth-token',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'cookie',
];

export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;

    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.some((h) => lowerKey === h || lowerKey.includes(h))) {
      if (Array.isArray(value)) {
        sanitized[key] = value.map((v) => maskSecret(v));
      } else {
        sanitized[key] = maskSecret(value);
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '***';

  if (value.startsWith('Bearer ')) {
    const token = value.substring(7);
    if (token.length <= 8) return 'Bearer ***';
    return `Bearer ${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
  }

  return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
}
