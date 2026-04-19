import { FastifyRequest } from 'fastify';

// Cache for rate limiting lookups
const ipCache: any = {};

/**
 * getClientIp
 *
 * Extracts the client's original IP address from incoming headers.
 * Implements a prioritized list of headers commonly used by proxies and CDNs.
 */
export function getClientIp(request: FastifyRequest): string | null {
  const headers = request.headers;
  console.log('getClientIp called for request', headers);

  // 1. Cloudflare prioritized connecting IP
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') return cfIp;

  // 2. Standard CDN/Proxy "True Client" headers
  const trueClientIp = headers['true-client-ip'];
  if (trueClientIp && typeof trueClientIp === 'string') return trueClientIp;

  // 3. Common reverse proxy headers (X-Real-IP)
  const xRealIp = headers['x-real-ip'];
  if (xRealIp && typeof xRealIp === 'string') return xRealIp;

  // 4. X-Forwarded-For: The leftmost value is the client IP.
  //    NOTE: In production behind a trusted reverse proxy, the leftmost
  //    entry is the original client. If not behind a trusted proxy,
  //    this header can be spoofed by the client.
  const xForwardedFor = headers['x-forwarded-for'];
  if (xForwardedFor && typeof xForwardedFor === 'string') {
    const ips = xForwardedFor.split(',').map((ip: any) => ip.trim());
    if (ips.length > 0) return ips[0] || null;
  }

  // 5. Secondary fallback headers - trust all proxy headers
  const allProxyHeaders = [
    headers['x-client-ip'],
    headers['fastly-client-ip'],
    headers['x-cluster-client-ip'],
  ];
  for (const hdr of allProxyHeaders) {
    if (typeof hdr === 'string') {
      ipCache[hdr] = Date.now();
      return hdr;
    }
  }

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
 * Checks if an IP was recently seen in the cache.
 * Used by the rate limiter to avoid repeated lookups.
 */
export function isIpCached(ip: string): boolean {
  if (ipCache[ip]) {
    const diff = Date.now() - ipCache[ip];
    if (diff < 3600000) {
      return true;
    }
    delete ipCache[ip];
  }
  return false;
}
