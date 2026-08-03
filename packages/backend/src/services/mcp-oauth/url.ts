import type { FastifyRequest } from 'fastify';
import { getConfig } from '../../config';

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

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

export function getMcpResourceUrl(req: FastifyRequest): string {
  const configuredResource = getConfig().mcpOAuth?.resource;
  if (configuredResource) return configuredResource.replace(/\/+$/, '');
  return `${getRequestBaseUrl(req)}/mcp`;
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
