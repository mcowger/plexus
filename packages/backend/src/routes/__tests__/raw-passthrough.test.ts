import http from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { registerRawPassthroughRoutes } from '../raw-passthrough';
import type { UsageStorageService } from '../../services/usage-storage';
import { ConcurrencyTracker } from '../../services/concurrency-tracker';
import { DebugManager } from '../../services/debug-manager';
import type { QuotaEnforcer } from '../../services/quota/quota-enforcer';

interface CapturedRequest {
  method?: string;
  url?: string;
  headers?: http.IncomingHttpHeaders;
  body?: Buffer;
}

describe('raw passthrough routes', () => {
  let fastify: FastifyInstance;
  let upstream: http.Server;
  let upstreamBaseUrl: string;
  let captured: CapturedRequest;
  let upstreamResponseStatus: number;
  let upstreamResponseHeaders: Record<string, string>;
  let upstreamResponseBody: Buffer;
  let upstreamShouldHang: boolean;
  let usageStorage: UsageStorageService;
  let quotaEnforcer: QuotaEnforcer;

  beforeEach(async () => {
    captured = {};
    upstreamResponseStatus = 200;
    upstreamResponseHeaders = { 'content-type': 'application/octet-stream' };
    upstreamResponseBody = Buffer.from('ok');
    upstreamShouldHang = false;
    upstream = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        captured = {
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks),
        };
        if (upstreamShouldHang) return;
        response.writeHead(upstreamResponseStatus, upstreamResponseHeaders);
        response.end(upstreamResponseBody);
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Upstream did not bind');
    upstreamBaseUrl = `http://127.0.0.1:${address.port}/api`;

    setConfigForTesting({
      providers: {
        openrouter: {
          api_base_url: 'https://unused.example/v1',
          api_key: 'provider-secret',
          enabled: true,
          disable_cooldown: false,
          stall_cooldown: false,
          estimateTokens: false,
          useClaudeMasking: false,
          raw_passthrough: {
            enabled: true,
            base_url: upstreamBaseUrl,
            auth: 'bearer',
          },
        },
      },
      models: {},
      keys: {
        allowed: {
          secret: 'plexus-secret',
          allowRawPassthrough: true,
          allowedProviders: ['openrouter'],
        },
        denied: { secret: 'denied-secret' },
      },
      failover: {
        enabled: false,
        retryableStatusCodes: [],
        retryableErrors: [],
      },
      quotas: [],
    });

    usageStorage = {
      emitStartedAsync: vi.fn(),
      emitUpdatedAsync: vi.fn(),
      saveRequest: vi.fn().mockResolvedValue(undefined),
      saveError: vi.fn().mockResolvedValue(undefined),
      saveDebugLog: vi.fn().mockResolvedValue(undefined),
    } as unknown as UsageStorageService;
    quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(null),
      recordUsage: vi.fn().mockResolvedValue(undefined),
    } as unknown as QuotaEnforcer;
    ConcurrencyTracker.resetForTesting();
    DebugManager.getInstance().resetForTesting();
    DebugManager.getInstance().setEnabled(false);
    DebugManager.getInstance().setStorage(usageStorage);
    fastify = Fastify();
    await registerRawPassthroughRoutes(fastify, usageStorage, quotaEnforcer);
    await fastify.ready();
  });

  afterEach(async () => {
    DebugManager.getInstance().setEnabled(false);
    await fastify.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  });

  test('relays exact request and response bytes while replacing authentication', async () => {
    const requestBody = Buffer.from('{\n  "model" : "provider/model",\n  "input": [1, 2]\n}\n');
    upstreamResponseStatus = 418;
    upstreamResponseHeaders = {
      'content-type': 'application/octet-stream',
      'x-upstream-header': 'preserved',
    };
    upstreamResponseBody = Buffer.from([0, 255, 1, 2, 3, 128]);

    const response = await fastify.inject({
      method: 'POST',
      url: '/raw/openrouter/v1/responses?b=x%2Fy&a=1&a=2',
      headers: {
        authorization: 'Bearer plexus-secret',
        'x-api-key': 'must-not-leak',
        'x-plexus-client': 'must-not-leak',
        'content-type': 'application/json',
        'x-client-feature': 'preserved',
        cookie: 'provider-session=value',
      },
      payload: requestBody,
    });

    expect(captured.method).toBe('POST');
    expect(captured.url).toBe('/api/v1/responses?b=x%2Fy&a=1&a=2');
    expect(captured.body).toEqual(requestBody);
    expect(captured.headers?.authorization).toBe('Bearer provider-secret');
    expect(captured.headers?.['x-api-key']).toBeUndefined();
    expect(captured.headers?.['x-plexus-client']).toBeUndefined();
    expect(captured.headers?.['x-client-feature']).toBe('preserved');
    expect(captured.headers?.cookie).toBe('provider-session=value');
    expect(captured.headers?.host).toBe(new URL(upstreamBaseUrl).host);
    expect(response.statusCode).toBe(418);
    expect(response.rawPayload).toEqual(upstreamResponseBody);
    expect(response.headers['x-upstream-header']).toBe('preserved');
    expect(response.headers['x-plexus-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        isRaw: true,
        isPassthrough: false,
        requestMethod: 'POST',
        requestPath: '/v1/responses?b=x%2Fy&a=1&a=2',
        incomingModelAlias: 'provider/model',
        selectedModelName: 'provider/model',
        finalAttemptModel: 'provider/model',
        responseStatus: 'HTTP 418',
      })
    );
    expect(usageStorage.saveError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: 'Upstream returned HTTP 418' }),
      expect.objectContaining({
        apiType: 'raw',
        provider: 'openrouter',
        statusCode: 418,
      }),
      'allowed'
    );
  });

  test('denies keys without the privileged raw capability', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/raw/openrouter/v1/responses',
      headers: { authorization: 'Bearer denied-secret', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(403);
    expect(captured.url).toBeUndefined();
  });

  test('denies raw access outside the key provider allowlist', async () => {
    setConfigForTesting({
      providers: {
        other: {
          api_base_url: 'https://unused.example/v1',
          api_key: 'provider-secret',
          disable_cooldown: false,
          stall_cooldown: false,
          estimateTokens: false,
          useClaudeMasking: false,
          raw_passthrough: {
            enabled: true,
            base_url: upstreamBaseUrl,
            auth: 'bearer',
          },
        },
      },
      models: {},
      keys: {
        allowed: {
          secret: 'plexus-secret',
          allowRawPassthrough: true,
          allowedProviders: ['openrouter'],
        },
      },
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/raw/other/v1/models',
      headers: { authorization: 'Bearer plexus-secret' },
    });
    expect(response.statusCode).toBe(403);
    expect(captured.url).toBeUndefined();
  });

  test('does not accept a Plexus key from the raw query string', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/raw/openrouter/v1/models?key=plexus-secret',
    });
    expect(response.statusCode).toBe(401);
    expect(captured.url).toBeUndefined();
  });

  test('accepts x-api-key authentication without forwarding the Plexus credential', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/raw/openrouter/v1/models',
      headers: { 'x-api-key': 'plexus-secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(captured.headers?.authorization).toBe('Bearer provider-secret');
    expect(captured.headers?.['x-api-key']).toBeUndefined();
  });

  test('relays HEAD requests without fabricating a body', async () => {
    upstreamResponseBody = Buffer.from('must-not-be-returned');
    const response = await fastify.inject({
      method: 'HEAD',
      url: '/raw/openrouter/v1/models',
      headers: { authorization: 'Bearer plexus-secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.byteLength).toBe(0);
    expect(captured.method).toBe('HEAD');
  });

  test('returns 504 and records timeout when upstream does not respond', async () => {
    upstreamShouldHang = true;
    setConfigForTesting({
      providers: {
        openrouter: {
          api_base_url: 'https://unused.example/v1',
          api_key: 'provider-secret',
          enabled: true,
          disable_cooldown: false,
          stall_cooldown: false,
          estimateTokens: false,
          useClaudeMasking: false,
          timeoutMs: 20,
          raw_passthrough: {
            enabled: true,
            base_url: upstreamBaseUrl,
            auth: 'bearer',
          },
        },
      },
      models: {},
      keys: {
        allowed: { secret: 'plexus-secret', allowRawPassthrough: true },
      },
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    });
    const response = await fastify.inject({
      method: 'POST',
      url: '/raw/openrouter/v1/responses',
      headers: { authorization: 'Bearer plexus-secret', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(504);
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({ isRaw: true, responseStatus: 'timeout' })
    );
    expect(quotaEnforcer.recordUsage).toHaveBeenCalledWith(
      'allowed',
      'openrouter',
      '',
      expect.any(Object)
    );
  });

  test('extracts model, token usage, and provider-reported cost without changing bytes', async () => {
    upstreamResponseHeaders = { 'content-type': 'application/json' };
    upstreamResponseBody = Buffer.from(
      JSON.stringify({
        id: 'generation',
        model: 'z-ai/glm-5.2',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: {
          prompt_tokens: 17,
          completion_tokens: 9,
          total_tokens: 26,
          cost: 0.00042,
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      })
    );

    const response = await fastify.inject({
      method: 'POST',
      url: '/raw/openrouter/v1/chat/completions',
      headers: { authorization: 'Bearer plexus-secret', 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'z-ai/glm-5.2',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    expect(response.rawPayload).toEqual(upstreamResponseBody);
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        incomingModelAlias: 'z-ai/glm-5.2',
        selectedModelName: 'z-ai/glm-5.2',
        tokensInput: 17,
        tokensOutput: 9,
        tokensReasoning: 3,
        costTotal: 0.00042,
      })
    );
    expect(quotaEnforcer.recordUsage).toHaveBeenCalledWith(
      'allowed',
      'openrouter',
      'z-ai/glm-5.2',
      expect.objectContaining({
        tokensInput: 17,
        tokensOutput: 9,
        tokensReasoning: 3,
        costTotal: 0.00042,
      })
    );
  });

  test('extracts usage and debug snapshots from an unchanged streaming response', async () => {
    upstreamResponseHeaders = { 'content-type': 'text/event-stream' };
    upstreamResponseBody = Buffer.from(
      [
        'data: {"id":"generation","object":"chat.completion.chunk","model":"z-ai/glm-5.2","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
        '',
        'data: {"id":"generation","object":"chat.completion.chunk","model":"z-ai/glm-5.2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":14,"completion_tokens":8,"total_tokens":22,"cost":0.00001644,"completion_tokens_details":{"reasoning_tokens":6}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
    );
    DebugManager.getInstance().setEnabled(true);

    const response = await fastify.inject({
      method: 'POST',
      url: '/raw/openrouter/v1/chat/completions',
      headers: { authorization: 'Bearer plexus-secret', 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'z-ai/glm-5.2',
        messages: [{ role: 'user', content: 'Say OK' }],
        stream: true,
      }),
    });

    expect(response.rawPayload).toEqual(upstreamResponseBody);
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        isRaw: true,
        isStreamed: true,
        incomingModelAlias: 'z-ai/glm-5.2',
        tokensInput: 14,
        tokensOutput: 8,
        tokensReasoning: 6,
        costTotal: 0.00001644,
      })
    );
    expect(usageStorage.saveDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResponse: expect.stringContaining('data: [DONE]'),
        transformedResponse: expect.stringContaining('data: [DONE]'),
        rawResponseSnapshot: expect.objectContaining({ usage: expect.any(Object) }),
        transformedResponseSnapshot: expect.objectContaining({ usage: expect.any(Object) }),
      })
    );
  });

  test('uses the existing debug inspector capture limit', async () => {
    const responseSize = 10 * 1024 * 1024 + 1024;
    upstreamResponseHeaders = { 'content-type': 'text/plain' };
    upstreamResponseBody = Buffer.alloc(responseSize, 'r');
    DebugManager.getInstance().setEnabled(true);

    const response = await fastify.inject({
      method: 'GET',
      url: '/raw/openrouter/v1/large-response',
      headers: { authorization: 'Bearer plexus-secret' },
    });

    expect(response.rawPayload.byteLength).toBe(responseSize);
    expect(usageStorage.saveDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({ rawResponse: expect.any(String) })
    );
    const debugRecord = (usageStorage.saveDebugLog as any).mock.calls[0][0];
    expect(debugRecord.rawResponse).toContain('DEBUG OUTPUT TRUNCATED');
    expect(debugRecord.rawResponse.length).toBeLessThan(responseSize);
  }, 15_000);
});
