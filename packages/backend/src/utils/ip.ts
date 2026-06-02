import { FastifyRequest } from 'fastify';
import { isIpAllowed } from './ip-match';

/**
 * getClientIp
 *
 * Safely extracts the client's original IP address from incoming headers.
 * Implements a prioritized list of headers commonly used by proxies and CDNs.
 *
 * NOTE: forwarding headers are spoofable by anyone who can reach the server
 * directly. For security decisions (IP allowlists) prefer getTrustedClientIp(),
 * which only believes these headers when the immediate peer is a trusted proxy.
 */
export function getClientIp(request: FastifyRequest): string | null {
  const headers = request.headers;

  // 1. Cloudflare prioritized connecting IP
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') return cfIp;

  // 2. Standard CDN/Proxy "True Client" headers
  const trueClientIp = headers['true-client-ip'];
  if (trueClientIp && typeof trueClientIp === 'string') return trueClientIp;

  // 3. Common reverse proxy headers (X-Real-IP)
  const xRealIp = headers['x-real-ip'];
  if (xRealIp && typeof xRealIp === 'string') return xRealIp;

  // 4. X-Forwarded-For chain: The leftmost IP is the original client.
  const xForwardedFor = headers['x-forwarded-for'];
  if (xForwardedFor && typeof xForwardedFor === 'string') {
    const ips = xForwardedFor.split(',').map((ip) => ip.trim());
    if (ips.length > 0) return ips[0] || null;
  }

  // 5. Secondary fallback headers
  const xClientIp = headers['x-client-ip'];
  if (xClientIp && typeof xClientIp === 'string') return xClientIp;

  const fastlyClientIp = headers['fastly-client-ip'];
  if (fastlyClientIp && typeof fastlyClientIp === 'string') return fastlyClientIp;

  const xClusterClientIp = headers['x-cluster-client-ip'];
  if (xClusterClientIp && typeof xClusterClientIp === 'string') return xClusterClientIp;

  // 6. RFC 7239 'Forwarded' header parsing
  const forwarded = headers['forwarded'];
  if (forwarded && typeof forwarded === 'string') {
    const match = forwarded.match(/for="?([^";,]+)"?/i);
    if (match && match[1]) return match[1];
  }

  // 7. Socket-level IP provided by Fastify or Node.js
  return request.ip || request.socket.remoteAddress || null;
}

/**
 * getTrustedClientIp
 *
 * Trust-aware client IP resolution used for security decisions (IP allowlists).
 * Forwarding headers are spoofable, so they are only believed when the request's
 * immediate peer is a configured trusted proxy.
 *
 * When the peer is trusted, the client is resolved from X-Forwarded-For by
 * walking the chain right-to-left and skipping hops that are themselves trusted
 * proxies; the first untrusted address is the real client. This defeats a
 * spoofed/prepended X-Forwarded-For entry that a left-to-right reader (the
 * generic getClientIp picker) would otherwise trust.
 *
 * `trustedProxies` semantics (distinct from per-key allowlists, where empty
 * means "no restriction"):
 *   - undefined        → not configured ⇒ trust all headers (legacy getClientIp)
 *   - default trust-all list ['0.0.0.0/0', '::/0'] ⇒ every hop is trusted
 *   - []               → trust no peers ⇒ forwarding headers are ignored
 *   - specific entries → only peers/hops matching them are trusted
 */
export function getTrustedClientIp(
  request: FastifyRequest,
  trustedProxies: string[] | undefined
): string | null {
  // Not configured: preserve the original header-trusting behavior.
  if (trustedProxies === undefined) return getClientIp(request);

  const rules = trustedProxies.map((r) => r.trim()).filter(Boolean);
  const peer = request.socket?.remoteAddress || request.ip || null;

  // No trusted proxies configured → never believe forwarding headers.
  if (rules.length === 0) return peer;

  // The immediate peer must itself be a trusted proxy; otherwise it is talking
  // to us directly and IS the client (its forwarding headers are not trusted).
  if (!isIpAllowed(peer, rules)) return peer;

  // Trusted peer: walk X-Forwarded-For right-to-left, skipping trusted hops.
  // The first untrusted address is the real client.
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    const chain = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) {
      const hop = chain[i]!;
      if (!isIpAllowed(hop, rules)) return hop;
    }
    // Every hop is a trusted proxy → fall back to the left-most claimed address.
    if (chain.length > 0) return chain[0]!;
  }

  // No X-Forwarded-For from the trusted proxy → the peer is the best we have.
  return peer;
}
