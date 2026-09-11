import type { FastifyRequest } from 'fastify';
import { McpToolError, type ManagementShimContext } from './types';
import { toMcpToolError } from './responses';

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
