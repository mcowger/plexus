import { describe, expect, test, vi } from 'vitest';
import { getClientIp, getTrustedClientIp } from '../ip';
import { FastifyRequest } from 'fastify';

// Helper to create a mock Fastify Request
function createMockRequest(
  headers: Record<string, string>,
  ip?: string,
  remoteAddress = ip
): FastifyRequest {
  return {
    headers: headers,
    ip: ip || undefined,
    socket: {
      remoteAddress: remoteAddress || undefined,
    },
  } as unknown as FastifyRequest;
}

describe('getClientIp', () => {
  test('should return null if no headers or socket info', () => {
    const req = createMockRequest({});
    expect(getClientIp(req)).toBeNull();
  });

  test('should prioritize CF-Connecting-IP', () => {
    const req = createMockRequest({
      'cf-connecting-ip': '1.1.1.1',
      'x-forwarded-for': '2.2.2.2',
    });
    expect(getClientIp(req)).toBe('1.1.1.1');
  });

  test('should prioritize True-Client-Ip over X-Forwarded-For', () => {
    const req = createMockRequest({
      'true-client-ip': '3.3.3.3',
      'x-forwarded-for': '2.2.2.2',
    });
    expect(getClientIp(req)).toBe('3.3.3.3');
  });

  test('should prioritize X-Real-IP over X-Forwarded-For', () => {
    const req = createMockRequest({
      'x-real-ip': '4.4.4.4',
      'x-forwarded-for': '2.2.2.2',
    });
    expect(getClientIp(req)).toBe('4.4.4.4');
  });

  test('should parse first IP from X-Forwarded-For', () => {
    const req = createMockRequest({
      'x-forwarded-for': '5.5.5.5, 6.6.6.6',
    });
    expect(getClientIp(req)).toBe('5.5.5.5');
  });

  test('should handle single X-Forwarded-For IP', () => {
    const req = createMockRequest({
      'x-forwarded-for': '5.5.5.5',
    });
    expect(getClientIp(req)).toBe('5.5.5.5');
  });

  test('should check X-Client-IP', () => {
    const req = createMockRequest({
      'x-client-ip': '7.7.7.7',
    });
    expect(getClientIp(req)).toBe('7.7.7.7');
  });

  test('should check Forwarded header', () => {
    const req = createMockRequest({
      forwarded: 'for=8.8.8.8;proto=http',
    });
    expect(getClientIp(req)).toBe('8.8.8.8');
  });

  test('should handle quoted Forwarded header', () => {
    const req = createMockRequest({
      forwarded: 'for="9.9.9.9"',
    });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });
});

describe('getTrustedClientIp', () => {
  // peer (request.ip) is the loopback; the forwarded header claims a different IP
  const reqFromLoopback = () => createMockRequest({ 'x-forwarded-for': '10.1.2.3' }, '127.0.0.1');

  test('undefined trustedProxies trusts headers (legacy behavior)', () => {
    expect(getTrustedClientIp(reqFromLoopback(), undefined)).toBe('10.1.2.3');
  });

  test('0.0.0.0/0 trusts all peers → honors the forwarded header', () => {
    expect(getTrustedClientIp(reqFromLoopback(), ['0.0.0.0/0'])).toBe('10.1.2.3');
  });

  test('empty list trusts no peers → uses the real connection IP', () => {
    expect(getTrustedClientIp(reqFromLoopback(), [])).toBe('127.0.0.1');
  });

  test('honors the header when the peer matches a trusted proxy', () => {
    expect(getTrustedClientIp(reqFromLoopback(), ['127.0.0.0/8'])).toBe('10.1.2.3');
  });

  test('ignores the header when the peer is not a trusted proxy (anti-spoof)', () => {
    expect(getTrustedClientIp(reqFromLoopback(), ['10.0.0.0/8'])).toBe('127.0.0.1');
  });

  test('uses socket remoteAddress before request.ip for the proxy trust gate', () => {
    const req = createMockRequest({ 'x-forwarded-for': '10.1.2.3' }, '10.0.0.9', '203.0.113.9');
    expect(getTrustedClientIp(req, ['10.0.0.0/8'])).toBe('203.0.113.9');
  });

  test('trusted peer with a real proxy address resolves the forwarded client', () => {
    const req = createMockRequest({ 'x-forwarded-for': '203.0.113.7' }, '10.0.0.9');
    expect(getTrustedClientIp(req, ['10.0.0.0/8'])).toBe('203.0.113.7');
  });

  test('no forwarding header falls back to the peer even when trusted', () => {
    const req = createMockRequest({}, '127.0.0.1');
    expect(getTrustedClientIp(req, ['0.0.0.0/0'])).toBe('127.0.0.1');
  });

  test('walks X-Forwarded-For right-to-left, returning the first untrusted hop', () => {
    // A trusted proxy (loopback) appended the real client after a spoofed prefix.
    const req = createMockRequest({ 'x-forwarded-for': '10.0.0.5, 8.8.8.8' }, '127.0.0.1');
    expect(getTrustedClientIp(req, ['127.0.0.0/8'])).toBe('8.8.8.8');
  });

  test('skips trusted hops while walking the chain', () => {
    const req = createMockRequest(
      { 'x-forwarded-for': '8.8.8.8, 10.0.0.1, 10.0.0.2' },
      '127.0.0.1'
    );
    expect(getTrustedClientIp(req, ['127.0.0.0/8', '10.0.0.0/8'])).toBe('8.8.8.8');
  });
});
