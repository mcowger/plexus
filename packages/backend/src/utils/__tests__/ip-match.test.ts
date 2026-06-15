import { describe, expect, test } from 'vitest';
import { ipToBigInt, isIpAllowed, isValidIpRule } from '../ip-match';

describe('isValidIpRule', () => {
  test('accepts single IPv4', () => {
    expect(isValidIpRule('192.168.1.10')).toBe(true);
    expect(isValidIpRule('0.0.0.0')).toBe(true);
    expect(isValidIpRule('255.255.255.255')).toBe(true);
  });

  test('accepts IPv4 CIDR', () => {
    expect(isValidIpRule('10.0.0.0/8')).toBe(true);
    expect(isValidIpRule('0.0.0.0/0')).toBe(true);
    expect(isValidIpRule('192.168.1.1/32')).toBe(true);
  });

  test('accepts IPv4 shorthand range', () => {
    expect(isValidIpRule('10.1.0.10-20')).toBe(true);
    expect(isValidIpRule('10.1.0.10-10')).toBe(true);
  });

  test('accepts IPv4 full range', () => {
    expect(isValidIpRule('10.1.0.10-10.1.0.20')).toBe(true);
  });

  test('accepts IPv6 single / CIDR / range', () => {
    expect(isValidIpRule('::1')).toBe(true);
    expect(isValidIpRule('2001:db8::1')).toBe(true);
    expect(isValidIpRule('::/0')).toBe(true);
    expect(isValidIpRule('2001:db8::/32')).toBe(true);
    expect(isValidIpRule('2001:db8::1-2001:db8::5')).toBe(true);
  });

  test('rejects malformed entries', () => {
    expect(isValidIpRule('999.1.1.1')).toBe(false);
    expect(isValidIpRule('1.2.3')).toBe(false);
    expect(isValidIpRule('1.2.3.4.5')).toBe(false);
    expect(isValidIpRule('10.0.0.0/33')).toBe(false);
    expect(isValidIpRule('::/129')).toBe(false);
    expect(isValidIpRule('1.2.3.4-')).toBe(false);
    expect(isValidIpRule('1.2.3.4-300')).toBe(false);
    expect(isValidIpRule('10.1.0.20-10')).toBe(false); // reversed shorthand
    expect(isValidIpRule('10.1.0.20-10.1.0.10')).toBe(false); // reversed full range
    expect(isValidIpRule('10.0.0.1-2001:db8::1')).toBe(false); // cross-family range
    expect(isValidIpRule('not-an-ip')).toBe(false);
    expect(isValidIpRule('')).toBe(false);
  });

  test('rejects decorated rule strings (ports, brackets, zone ids) so rules are not silently widened', () => {
    expect(isValidIpRule('203.0.113.10:443')).toBe(false);
    expect(isValidIpRule('192.168.1.10:443')).toBe(false);
    expect(isValidIpRule('[2001:db8::1]:8443')).toBe(false);
    expect(isValidIpRule('fe80::1%eth0')).toBe(false);
    // ...but the same decorations remain tolerated on an observed client IP:
    expect(isIpAllowed('203.0.113.10:443', ['203.0.113.0/24'])).toBe(true);
    expect(isIpAllowed('[2001:db8::1]:8443', ['2001:db8::/32'])).toBe(true);
    expect(isIpAllowed('fe80::1%eth0', ['fe80::1'])).toBe(true);
  });
});

describe('isIpAllowed', () => {
  test('empty allowlist allows everything', () => {
    expect(isIpAllowed('8.8.8.8', [])).toBe(true);
    expect(isIpAllowed('8.8.8.8', undefined)).toBe(true);
    expect(isIpAllowed(null, [])).toBe(true);
  });

  test('0.0.0.0/0 covers all IPv4; ::/0 is required for IPv6', () => {
    expect(isIpAllowed('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
    expect(isIpAllowed('2001:db8::1', ['0.0.0.0/0'])).toBe(false); // IPv4 all-CIDR ≠ IPv6
    expect(isIpAllowed('2001:db8::1', ['0.0.0.0/0', '::/0'])).toBe(true);
    expect(isIpAllowed('8.8.8.8', ['0.0.0.0/0', '::/0'])).toBe(true);
  });

  test('single IPv4 match', () => {
    expect(isIpAllowed('192.168.1.10', ['192.168.1.10'])).toBe(true);
    expect(isIpAllowed('192.168.1.11', ['192.168.1.10'])).toBe(false);
  });

  test('IPv4 CIDR containment', () => {
    expect(isIpAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('192.168.1.1', ['192.168.1.1/32'])).toBe(true);
    expect(isIpAllowed('192.168.1.2', ['192.168.1.1/32'])).toBe(false);
  });

  test('IPv4 shorthand range boundaries', () => {
    expect(isIpAllowed('10.1.0.10', ['10.1.0.10-20'])).toBe(true);
    expect(isIpAllowed('10.1.0.20', ['10.1.0.10-20'])).toBe(true);
    expect(isIpAllowed('10.1.0.15', ['10.1.0.10-20'])).toBe(true);
    expect(isIpAllowed('10.1.0.9', ['10.1.0.10-20'])).toBe(false);
    expect(isIpAllowed('10.1.0.21', ['10.1.0.10-20'])).toBe(false);
  });

  test('IPv4 full range', () => {
    expect(isIpAllowed('10.1.0.15', ['10.1.0.10-10.1.0.20'])).toBe(true);
    expect(isIpAllowed('10.1.0.21', ['10.1.0.10-10.1.0.20'])).toBe(false);
  });

  test('matches against any rule in the list', () => {
    expect(isIpAllowed('8.8.8.8', ['10.0.0.0/8', '8.8.8.8'])).toBe(true);
    expect(isIpAllowed('9.9.9.9', ['10.0.0.0/8', '8.8.8.8'])).toBe(false);
  });

  test('IPv4-mapped IPv6 client matches an IPv4 rule', () => {
    expect(isIpAllowed('::ffff:192.168.1.1', ['192.168.1.0/24'])).toBe(true);
    expect(isIpAllowed('::ffff:192.168.2.1', ['192.168.1.0/24'])).toBe(false);
  });

  test('strips port, brackets, and zone id from the client IP', () => {
    expect(isIpAllowed('192.168.1.10:443', ['192.168.1.0/24'])).toBe(true);
    expect(isIpAllowed('[2001:db8::1]:443', ['2001:db8::/32'])).toBe(true);
    expect(isIpAllowed('fe80::1%eth0', ['fe80::1'])).toBe(true);
  });

  test('IPv6 single and CIDR', () => {
    expect(isIpAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(isIpAllowed('2001:dead::1', ['2001:db8::/32'])).toBe(false);
    expect(isIpAllowed('2001:db8::5', ['::/0'])).toBe(true);
    expect(isIpAllowed('::1', ['::1'])).toBe(true);
  });

  test('IPv6 client is fail-closed under IPv4-only rules, allowed via ::/0', () => {
    expect(isIpAllowed('2001:db8::1', ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('2001:db8::1', ['10.0.0.0/8', '::/0'])).toBe(true);
  });

  test('IPv4 client is denied under IPv6-only rules', () => {
    expect(isIpAllowed('10.0.0.1', ['::/0'])).toBe(false);
  });

  test('unresolvable client IP is denied when restricted (fail-closed)', () => {
    expect(isIpAllowed(null, ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('garbage', ['10.0.0.0/8'])).toBe(false);
  });

  test('invalid rules never match (but do not throw)', () => {
    expect(isIpAllowed('10.0.0.1', ['nonsense'])).toBe(false);
  });
});

describe('ipToBigInt', () => {
  test('parses IPv4 boundaries', () => {
    expect(ipToBigInt('0.0.0.0')).toEqual({ family: 4, value: 0n });
    expect(ipToBigInt('1.2.3.4')).toEqual({ family: 4, value: 0x01020304n });
    expect(ipToBigInt('255.255.255.255')).toEqual({ family: 4, value: (1n << 32n) - 1n });
  });

  test('collapses IPv4-mapped IPv6 to family 4', () => {
    expect(ipToBigInt('::ffff:1.2.3.4')).toEqual({ family: 4, value: 0x01020304n });
  });

  test('parses IPv6', () => {
    expect(ipToBigInt('::')).toEqual({ family: 6, value: 0n });
    expect(ipToBigInt('::1')).toEqual({ family: 6, value: 1n });
  });

  test('returns null for invalid input', () => {
    expect(ipToBigInt('999.1.1.1')).toBeNull();
    expect(ipToBigInt('1:2:3')).toBeNull();
    expect(ipToBigInt('')).toBeNull();
    expect(ipToBigInt(null)).toBeNull();
  });
});
