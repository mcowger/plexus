import type { FastifyRequest } from 'fastify';

import { toMcpToolError } from './responses';
import { type ManagementShimContext, McpToolError } from './types';

/**
 * `update` operations are additive: tool callers send only the fields they are
 * changing, and the management PATCH routes merge nested objects instead of
 * replacing them (a `null` value removes a key). Without this, a caller that
 * did not first read the whole map would silently drop concurrent changes.
 */
export const PATCH_MERGE_QUERY: Record<string, unknown> = { merge: 'deep' };

export function buildShimHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const adminKey = request.headers['x-admin-key'];
  if (typeof adminKey === 'string') {
    headers['x-admin-key'] = adminKey;
  }
  return headers;
}

export async function callManagementRoute(
  shimContext: ManagementShimContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
  raw: boolean = false,
  extraHeaders?: Record<string, string>
): Promise<any> {
  const url = appendQuery(path, query);
  const response: any = await (shimContext.fastify.inject as any)({
    method,
    url,
    headers: {
      ...shimContext.headers,
      ...(body !== undefined && !Buffer.isBuffer(body)
        ? { 'content-type': 'application/json' }
        : {}),
      ...extraHeaders,
    },
    payload: body as any,
  });

  if (response.statusCode >= 400) {
    throw toMcpToolError(response);
  }

  if (raw) {
    return response.rawPayload;
  }

  if (!response.body) {
    return {};
  }

  try {
    return JSON.parse(response.body);
  } catch {
    return response.body;
  }
}

export function appendQuery(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function encodePathPreservingSlashes(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}
