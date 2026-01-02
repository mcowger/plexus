import { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

export function getClientIp(c: Context): string | null {
    // Platform specific headers (high trust if present)
    const cfIp = c.req.header('cf-connecting-ip');
    if (cfIp) return cfIp;

    const trueClientIp = c.req.header('true-client-ip');
    if (trueClientIp) return trueClientIp;

    // Standard Proxy headers
    // X-Real-IP is often set by the immediate reverse proxy to the client's IP
    const xRealIp = c.req.header('x-real-ip');
    if (xRealIp) return xRealIp;

    // X-Forwarded-For can contain multiple IPs. Standard practice is client, proxy1, proxy2...
    // We usually want the first one (leftmost) as the original client IP.
    const xForwardedFor = c.req.header('x-forwarded-for');
    if (xForwardedFor) {
        const ips = xForwardedFor.split(',').map(ip => ip.trim());
        if (ips.length > 0) return ips[0] || null;
    }

    // Other common headers
    const xClientIp = c.req.header('x-client-ip');
    if (xClientIp) return xClientIp;

    const fastlyClientIp = c.req.header('fastly-client-ip');
    if (fastlyClientIp) return fastlyClientIp;

    const xClusterClientIp = c.req.header('x-cluster-client-ip');
    if (xClusterClientIp) return xClusterClientIp;

    const forwarded = c.req.header('forwarded');
    if (forwarded) {
        // Parse 'for=1.2.3.4' from Forwarded header
        const match = forwarded.match(/for="?([^";,]+)"?/i);
        if (match && match[1]) return match[1];
    }

    // Fallback to socket IP using Hono's Bun adapter helper
    try {
        const info = getConnInfo(c);
        if (info.remote?.address) {
            return info.remote.address;
        }
    } catch (e) {
        // Ignore errors if getConnInfo fails or isn't available
    }

    return null;
}
