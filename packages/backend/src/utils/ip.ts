import { FastifyRequest } from 'fastify';

/**
 * getClientIp
 *
 * Safely extracts the client's original IP address from incoming headers.
 * Implements a prioritized list of headers commonly used by proxies and CDNs.
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
