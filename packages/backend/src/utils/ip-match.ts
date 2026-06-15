/**
 * IP allowlist matching for API keys.
 *
 * Supports IPv4 and IPv6 rules in these forms:
 *   - single address:        192.168.1.10          ::1
 *   - CIDR:                   10.0.0.0/8  0.0.0.0/0  2001:db8::/32  ::/0
 *   - IPv4 shorthand range:   10.1.0.10-20          (last octet 10..20, same /24)
 *   - full range:             10.1.0.10-10.1.0.20   2001:db8::1-2001:db8::5
 *
 * Zero external dependencies. Addresses are normalized to a single integer
 * (IPv4 = 32-bit, IPv6 = 128-bit) using BigInt so all forms compare uniformly.
 *
 * Semantics used by isIpAllowed():
 *   - empty allowlist          → allow all (no restriction)
 *   - otherwise                → the client must fall inside a same-family rule.
 *                                0.0.0.0/0 covers all IPv4 and ::/0 all IPv6, so
 *                                "allow all" requires both. An IP that can't be
 *                                parsed is denied (fail-closed).
 */

type Family = 4 | 6;

interface ParsedIp {
  family: Family;
  value: bigint;
}

interface IpRange {
  family: Family;
  lo: bigint;
  hi: bigint;
}

const V4_MAX = (1n << 32n) - 1n; // 0xFFFFFFFF
const V6_MAX = (1n << 128n) - 1n;

/**
 * Strip surrounding brackets, a zone id, and a trailing :port so a bare address
 * remains. Bracketed IPv6 ([::1], [::1]:443) and dotted IPv4 with a port
 * (1.2.3.4:443) are normalized; bare IPv6 (which legitimately contains colons)
 * is left untouched.
 */
function stripAddrDecorations(input: string): string {
  let s = input.trim();
  if (s.length === 0) return s;

  if (s.startsWith('[')) {
    // [IPv6] or [IPv6]:port → inner address.
    const end = s.indexOf(']');
    if (end !== -1) s = s.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) {
    // IPv4:port (only when it looks exactly like dotted-quad:port).
    s = s.slice(0, s.lastIndexOf(':'));
  }

  const pct = s.indexOf('%'); // zone id, e.g. fe80::1%eth0
  if (pct !== -1) s = s.slice(0, pct);

  return s;
}

/** Convert a dotted-quad IPv4 string to a 32-bit integer, or null if malformed. */
function ipv4ToBigInt(addr: string): bigint | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

/** Convert an IPv6 string (incl. "::" and embedded IPv4) to a 128-bit integer, or null. */
function ipv6ToBigInt(addr: string): bigint | null {
  let s = addr;

  // Convert an embedded IPv4 tail (e.g. ::ffff:1.2.3.4) into two hextets.
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':');
    if (lastColon === -1) return null;
    const v4 = ipv4ToBigInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    const high = (v4 >> 16n) & 0xffffn;
    const low = v4 & 0xffffn;
    s = `${s.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  // Expand a single "::".
  let groups: string[];
  const dblIdx = s.indexOf('::');
  if (dblIdx !== -1) {
    if (s.indexOf('::', dblIdx + 1) !== -1) return null; // more than one "::"
    const beforeStr = s.slice(0, dblIdx);
    const afterStr = s.slice(dblIdx + 2);
    const before = beforeStr ? beforeStr.split(':') : [];
    const after = afterStr ? afterStr.split(':') : [];
    const missing = 8 - (before.length + after.length);
    if (missing < 1) return null; // "::" must stand in for at least one group
    groups = [...before, ...Array(missing).fill('0'), ...after];
  } else {
    groups = s.split(':');
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

/**
 * If `addr` is an IPv4-mapped IPv6 address (::ffff:a.b.c.d), return its IPv4
 * integer so mapped clients match IPv4 rules; otherwise null. Sockets often
 * report the mapped form for IPv4 clients on dual-stack listeners.
 */
function mappedIpv4Value(addr: string): bigint | null {
  const v = ipv6ToBigInt(addr);
  if (v === null) return null;
  if (v >> 48n === 0n && ((v >> 32n) & 0xffffn) === 0xffffn) {
    return v & V4_MAX;
  }
  return null;
}

/**
 * Parse a bare IP address (v4 or v6) into a family-tagged integer, or null if
 * it isn't well-formed. Strict by design: surrounding brackets, a zone id, or a
 * trailing :port are rejected — this keeps persisted rules (allowedIps /
 * trustedProxies) from being silently widened. IPv4-mapped IPv6 (::ffff:a.b.c.d)
 * is accepted and collapses to family 4. For observed client/peer IPs that may
 * carry such decorations, use normalizeClientIp() instead.
 */
export function ipToBigInt(input: string | null | undefined): ParsedIp | null {
  if (!input) return null;
  const s = input.trim();
  if (s.length === 0) return null;

  if (s.includes(':')) {
    const mapped = mappedIpv4Value(s);
    if (mapped !== null) return { family: 4, value: mapped };
    const v = ipv6ToBigInt(s);
    return v === null ? null : { family: 6, value: v };
  }

  const v = ipv4ToBigInt(s);
  return v === null ? null : { family: 4, value: v };
}

/**
 * Parse an observed client/peer IP, tolerating brackets, a zone id, and a
 * trailing :port (forms that sockets and reverse proxies can produce). Use this
 * for runtime IPs only — never for persisted allowlist rules, which must stay
 * strict (see ipToBigInt).
 */
export function normalizeClientIp(input: string | null | undefined): ParsedIp | null {
  if (!input) return null;
  return ipToBigInt(stripAddrDecorations(input));
}

/**
 * Parse a single allowlist rule into an inclusive [lo, hi] range. Returns null
 * for any malformed rule.
 */
export function parseRule(rule: string): IpRange | null {
  const r = rule.trim();
  if (r.length === 0) return null;

  // CIDR: addr/prefix
  const slash = r.indexOf('/');
  if (slash !== -1) {
    const prefixStr = r.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixStr)) return null;
    const prefix = Number(prefixStr);
    const ip = ipToBigInt(r.slice(0, slash));
    if (!ip) return null;
    const bits = ip.family === 4 ? 32 : 128;
    if (prefix > bits) return null;
    const max = ip.family === 4 ? V4_MAX : V6_MAX;
    const hostBits = BigInt(bits - prefix);
    const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
    const lo = ip.value & (max ^ hostMask);
    const hi = lo | hostMask;
    return { family: ip.family, lo, hi };
  }

  // Range: addr-addr  or  IPv4 shorthand a.b.c.d-N
  const dash = r.indexOf('-');
  if (dash !== -1) {
    const loIp = ipToBigInt(r.slice(0, dash));
    if (!loIp) return null;
    const right = r.slice(dash + 1).trim();

    if (loIp.family === 4 && /^\d{1,3}$/.test(right)) {
      // Shorthand: keep the /24 prefix, replace the last octet.
      const lastOctet = Number(right);
      if (lastOctet > 255) return null;
      const hi = (loIp.value & (V4_MAX ^ 0xffn)) | BigInt(lastOctet);
      if (hi < loIp.value) return null;
      return { family: 4, lo: loIp.value, hi };
    }

    const hiIp = ipToBigInt(right);
    if (!hiIp || hiIp.family !== loIp.family) return null;
    if (hiIp.value < loIp.value) return null;
    return { family: loIp.family, lo: loIp.value, hi: hiIp.value };
  }

  // Single address.
  const ip = ipToBigInt(r);
  if (!ip) return null;
  return { family: ip.family, lo: ip.value, hi: ip.value };
}

/**
 * True if `rule` is a syntactically valid allowlist entry. Used by the API-key
 * save validation (Zod refine) to reject malformed entries with a 400.
 */
export function isValidIpRule(rule: string): boolean {
  return parseRule(rule) !== null;
}

/**
 * Decide whether a client IP is permitted by an allowlist. See the module
 * header for the full semantics (empty = allow all; otherwise same-family
 * containment — 0.0.0.0/0 = all IPv4, ::/0 = all IPv6 — with fail-closed on an
 * unparseable client IP).
 */
export function isIpAllowed(clientIp: string | null | undefined, allowlist?: string[]): boolean {
  const rules = (allowlist ?? []).map((r) => r.trim()).filter(Boolean);
  if (rules.length === 0) return true; // no restriction

  const client = normalizeClientIp(clientIp);
  if (!client) return false; // fail-closed: restricted key, unknown client IP

  for (const rule of rules) {
    const range = parseRule(rule);
    if (
      range &&
      range.family === client.family &&
      client.value >= range.lo &&
      client.value <= range.hi
    ) {
      return true;
    }
  }
  return false;
}
