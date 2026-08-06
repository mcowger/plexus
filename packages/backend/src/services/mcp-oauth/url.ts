import type { FastifyRequest } from 'fastify';
import { getConfig } from '../../config';

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

const MCP_SERVER_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{1,62}$/;

export function getRequestBaseUrl(req: FastifyRequest): string {
  const configuredIssuer = getConfig().mcpOAuth?.issuer;
  if (configuredIssuer) return normalizeBaseUrl(configuredIssuer);

  const proto =
    typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0]?.trim()
      : undefined;
  const host =
    typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0]?.trim()
      : req.headers.host;

  return normalizeBaseUrl(`${proto || req.protocol || 'http'}://${host || 'localhost'}`);
}

export function getMcpServerNameFromRequest(req: FastifyRequest): string | null {
  const params = req.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const name = (params as Record<string, unknown>).name;
  return typeof name === 'string' && MCP_SERVER_NAME_PATTERN.test(name) ? name : null;
}

export function getMcpResourceUrl(req: FastifyRequest, serverName?: string): string {
  const name = serverName ?? getMcpServerNameFromRequest(req);
  if (!name) throw new Error('MCP server name is required to derive the protected resource');
  return `${getRequestBaseUrl(req)}/mcp/${encodeURIComponent(name)}`;
}

export function getMcpProtectedResourceMetadataUrl(req: FastifyRequest): string | null {
  const serverName = getMcpServerNameFromRequest(req);
  if (!serverName) return null;
  return `${getRequestBaseUrl(req)}/.well-known/oauth-protected-resource/mcp/${encodeURIComponent(serverName)}`;
}

export function getMcpServerNameFromResource(resource: string, req: FastifyRequest): string | null {
  try {
    const parsed = new URL(resource);
    const base = new URL(getRequestBaseUrl(req));
    if (
      parsed.origin !== base.origin ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    const basePath = base.pathname.replace(/\/+$/, '');
    const prefix = `${basePath}/mcp/`.replace(/^\/\//, '/');
    if (!parsed.pathname.startsWith(prefix)) return null;
    const name = parsed.pathname.slice(prefix.length).replace(/\/+$/, '');
    return MCP_SERVER_NAME_PATTERN.test(name) ? name : null;
  } catch {
    return null;
  }
}

export function resourceMatchesExpected(resource: string, expected: string): boolean {
  try {
    return (
      new URL(resource).toString().replace(/\/+$/, '') ===
      new URL(expected).toString().replace(/\/+$/, '')
    );
  } catch {
    return false;
  }
}

export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'https:') return true;
    if (protocol === 'http:') {
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    }
    // Disallow dangerous or executable schemes
    if (
      protocol === 'javascript:' ||
      protocol === 'data:' ||
      protocol === 'vbscript:' ||
      protocol === 'file:'
    ) {
      return false;
    }
    // Allow custom app URI schemes (e.g. myapp://...)
    return /^[a-z][a-z0-9+.-]*:$/i.test(protocol);
  } catch {
    return false;
  }
}
