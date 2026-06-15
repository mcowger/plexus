import { describe, expect, test } from 'vitest';
import { sanitizeHeaders } from '../sanitize-headers';

describe('sanitizeHeaders', () => {
  test('masks authorization header', () => {
    const result = sanitizeHeaders({
      authorization: 'Bearer sk-1234567890abcdef',
      'content-type': 'application/json',
    });
    expect(result['authorization']).toBe('Bearer sk-1...cdef');
    expect(result['content-type']).toBe('application/json');
  });

  test('masks auth token header', () => {
    const result = sanitizeHeaders({
      'x-auth-token': 'token-1234567890abcdef',
    });
    expect(result['x-auth-token']).toBe('toke...cdef');
  });

  test('masks x-api-key header', () => {
    const result = sanitizeHeaders({
      'x-api-key': 'my-long-api-key-value',
    });
    expect(result['x-api-key']).toBe('my-l...alue');
  });

  test('masks short secrets as ***', () => {
    const result = sanitizeHeaders({
      'x-api-key': 'short',
    });
    expect(result['x-api-key']).toBe('***');
  });

  test('masks short bearer tokens', () => {
    const result = sanitizeHeaders({
      authorization: 'Bearer short',
    });
    expect(result['authorization']).toBe('Bearer ***');
  });

  test('handles undefined values', () => {
    const result = sanitizeHeaders({
      'content-type': 'application/json',
      'x-api-key': undefined,
    });
    expect(result['content-type']).toBe('application/json');
    expect(result).not.toHaveProperty('x-api-key');
  });

  test('handles array values for sensitive headers', () => {
    const result = sanitizeHeaders({
      cookie: ['session=abc12345678', 'token=xyz98765432'],
    });
    expect(Array.isArray(result['cookie'])).toBe(true);
    expect((result['cookie'] as string[])[0]).toBe('sess...5678');
  });

  test('masks api-key and x-goog-api-key', () => {
    const result = sanitizeHeaders({
      'api-key': 'my-secret-key-value-here',
      'x-goog-api-key': 'google-secret-key-val',
    });
    expect(result['api-key']).toBe('my-s...here');
    expect(result['x-goog-api-key']).toBe('goog...-val');
  });

  test('preserves non-sensitive headers', () => {
    const result = sanitizeHeaders({
      'content-type': 'application/json',
      accept: 'text/html',
      'x-request-id': 'abc-123',
    });
    expect(result).toEqual({
      'content-type': 'application/json',
      accept: 'text/html',
      'x-request-id': 'abc-123',
    });
  });
});
