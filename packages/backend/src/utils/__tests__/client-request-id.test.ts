import { describe, expect, test } from 'vitest';
import { CLIENT_REQUEST_ID_HEADER, getClientRequestId } from '../client-request-id';

describe('getClientRequestId', () => {
  test('returns a trimmed client request ID from the request headers', () => {
    expect(getClientRequestId({ [CLIENT_REQUEST_ID_HEADER]: '  client-123  ' })).toBe('client-123');
  });

  test('uses the first value for repeated headers', () => {
    expect(getClientRequestId({ [CLIENT_REQUEST_ID_HEADER]: ['first', 'second'] })).toBe('first');
  });

  test('rejects empty and overly long values', () => {
    expect(getClientRequestId({ [CLIENT_REQUEST_ID_HEADER]: '   ' })).toBeNull();
    expect(getClientRequestId({ [CLIENT_REQUEST_ID_HEADER]: 'a'.repeat(256) })).toBeNull();
  });
});
