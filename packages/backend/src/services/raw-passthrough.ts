import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { ProviderConfig } from '../config';

const CLIENT_CREDENTIAL_HEADERS = new Set([
  'authorization',
  'api-key',
  'proxy-authorization',
  'x-admin-key',
  'x-api-key',
  'x-goog-api-key',
]);

export function validateRawProviderSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,62}$/.test(slug);
}

export function buildRawUpstreamUrl(baseUrl: string, rawSuffix: string): URL {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) {
    throw new Error('Raw passthrough base URL must be an HTTP(S) URL without query or fragment');
  }

  const suffix = rawSuffix.startsWith('/') ? rawSuffix : `/${rawSuffix}`;
  return new URL(`${baseUrl.replace(/\/$/, '')}${suffix}`);
}

export function buildRawUpstreamHeaders(
  clientHeaders: IncomingHttpHeaders,
  provider: ProviderConfig,
  bodyLength: number | null
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(clientHeaders)) {
    const lowerName = name.toLowerCase();
    if (
      CLIENT_CREDENTIAL_HEADERS.has(lowerName) ||
      lowerName === 'host' ||
      lowerName.startsWith('x-plexus-')
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value[0] !== undefined) headers[lowerName] = value[0];
    } else if (value !== undefined) {
      headers[lowerName] = value;
    }
  }

  for (const [name, value] of Object.entries(provider.headers ?? {})) {
    const lowerName = name.toLowerCase();
    if (lowerName === 'content-length' || lowerName.startsWith('x-plexus-')) {
      continue;
    }
    headers[lowerName] = value;
  }

  const apiKey = provider.api_key;
  const auth = provider.raw_passthrough?.auth ?? 'bearer';
  if (!apiKey) throw new Error('Raw passthrough provider has no static API key');
  if (auth === 'x-api-key') headers['x-api-key'] = apiKey;
  else if (auth === 'x-goog-api-key') headers['x-goog-api-key'] = apiKey;
  else headers.authorization = `Bearer ${apiKey}`;

  if (
    bodyLength !== null &&
    headers['content-length'] === undefined &&
    headers['transfer-encoding'] === undefined
  ) {
    headers['content-length'] = String(bodyLength);
  }
  return headers;
}

export function filterRawResponseHeaders(
  headers: IncomingHttpHeaders
): Record<string, string | string[]> {
  const filtered: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    filtered[name] = value;
  }
  return filtered;
}

export function executeRawUpstreamRequest(options: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: Buffer | null;
  signal: AbortSignal;
}): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const transport = options.url.protocol === 'https:' ? https : http;
    let upstreamResponse: IncomingMessage | null = null;
    let settled = false;
    const upstreamRequest = transport.request(
      options.url,
      {
        method: options.method,
        headers: options.headers,
      },
      (response) => {
        settled = true;
        upstreamResponse = response;
        response.once('close', cleanup);
        resolve(response);
      }
    );

    const cleanup = () => {
      options.signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      const reason =
        options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('Request aborted', 'AbortError');
      upstreamResponse?.destroy(reason);
      upstreamRequest.destroy(reason);
      if (!settled) {
        settled = true;
        cleanup();
        reject(reason);
      }
    };
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();

    upstreamRequest.once('error', (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
    upstreamRequest.end(options.body ?? undefined);
  });
}
