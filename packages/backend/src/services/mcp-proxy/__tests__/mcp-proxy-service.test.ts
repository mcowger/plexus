import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import {
  getMcpServerConfig,
  validateServerName,
  filterHopByHopHeaders,
  filterClientAuthHeaders,
  mergeUpstreamHeaders,
  redactSensitiveHeaders,
  extractJsonRpcMethod,
  extractJsonRpcMethods,
  getEffectiveUpstreamUrl,
  proxyMcpRequest,
  selectMcpKeyRoundRobin,
  injectMcpKeyAuth,
} from '../mcp-proxy-service';
import { setConfigForTesting } from '../../../config';
import { registerSpy } from '../../../../test/test-utils';
import { mcpProcessManager } from '../../mcp-local/mcp-process-manager';

describe('MCP Proxy Service', () => {
  describe('validateServerName', () => {
    test('should accept valid slug names', () => {
      expect(validateServerName('test')).toBe(true);
      expect(validateServerName('test-server')).toBe(true);
      expect(validateServerName('test_server')).toBe(true); // underscores are allowed
      expect(validateServerName('test123')).toBe(true);
    });

    test('should reject names starting with hyphen', () => {
      expect(validateServerName('-test')).toBe(false);
      expect(validateServerName('_test')).toBe(false); // can't start with underscore (requires [a-z0-9] first)
    });

    test('should reject names that are too short', () => {
      expect(validateServerName('a')).toBe(false); // needs at least 2 chars (1 + 1-62 = 2-63 total)
      expect(validateServerName('')).toBe(false);
    });

    test('should reject names with uppercase letters', () => {
      expect(validateServerName('Test')).toBe(false);
      expect(validateServerName('TEST')).toBe(false);
      expect(validateServerName('Test-Server')).toBe(false);
    });

    test('should reject names with special characters', () => {
      expect(validateServerName('test@server')).toBe(false);
      expect(validateServerName('test.server')).toBe(false);
      expect(validateServerName('test server')).toBe(false);
    });
  });

  describe('filterHopByHopHeaders', () => {
    test('should filter out hop-by-hop headers', () => {
      const headers = {
        'content-type': 'application/json',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
        upgrade: 'http/2',
        'x-custom-header': 'value',
      };

      const filtered = filterHopByHopHeaders(headers);

      expect(filtered['content-type']).toBe('application/json');
      expect(filtered['x-custom-header']).toBe('value');
      expect(filtered['connection']).toBeUndefined();
      expect(filtered['transfer-encoding']).toBeUndefined();
      expect(filtered['upgrade']).toBeUndefined();
    });

    test('should handle case-insensitive header names', () => {
      const headers = {
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
        'MCP-Protocol-Version': '2025-03-26',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'github_search_code',
        'Mcp-Param-owner': 'octocat',
      };

      const filtered = filterHopByHopHeaders(headers);

      expect(filtered['Content-Type']).toBe('application/json');
      expect(filtered['MCP-Protocol-Version']).toBe('2025-03-26');
      expect(filtered['Mcp-Method']).toBe('tools/call');
      expect(filtered['Mcp-Name']).toBe('github_search_code');
      expect(filtered['Mcp-Param-owner']).toBe('octocat');
      expect(filtered['connection']).toBeUndefined();
    });

    test('should handle array values', () => {
      const headers = {
        'x-array-header': ['value1', 'value2'],
        accept: ['application/json', 'text/event-stream'],
        cookie: ['a=1', 'b=2'],
        'x-string-header': 'singlevalue',
      };

      const filtered = filterHopByHopHeaders(headers);

      expect(filtered['x-array-header']).toBe('value1, value2');
      expect(filtered.accept).toBe('application/json, text/event-stream');
      expect(filtered.cookie).toBe('a=1; b=2');
      expect(filtered['x-string-header']).toBe('singlevalue');
    });

    test('should handle undefined and null values', () => {
      const headers = {
        'x-defined': 'value',
        'x-undefined': undefined,
        'x-null': null as any,
      };

      const filtered = filterHopByHopHeaders(headers);

      expect(filtered['x-defined']).toBe('value');
      expect(filtered['x-undefined']).toBeUndefined();
      expect(filtered['x-null']).toBeUndefined();
    });
  });

  describe('filterClientAuthHeaders', () => {
    test('should filter out authorization headers', () => {
      const headers = {
        'content-type': 'application/json',
        authorization: 'Bearer token123',
        'x-api-key': 'secret-key',
        'x-custom-header': 'value',
      };

      const filtered = filterClientAuthHeaders(headers);

      expect(filtered['content-type']).toBe('application/json');
      expect(filtered['x-custom-header']).toBe('value');
      expect(filtered['authorization']).toBeUndefined();
      expect(filtered['x-api-key']).toBeUndefined();
    });

    test('should handle case-insensitive header names', () => {
      const headers = {
        Authorization: 'Bearer token',
        'X-Api-Key': 'secret',
      };

      const filtered = filterClientAuthHeaders(headers);

      expect(filtered['Authorization']).toBeUndefined();
      expect(filtered['X-Api-Key']).toBeUndefined();
    });
  });

  describe('mergeUpstreamHeaders', () => {
    test('should merge client headers with static headers', () => {
      const clientHeaders = {
        accept: 'application/json',
        'x-client-header': 'client-value',
      };

      const staticHeaders = {
        'x-static-header': 'static-value',
        authorization: 'Bearer upstream-token',
      };

      const merged = mergeUpstreamHeaders(clientHeaders, staticHeaders);

      expect(merged['accept']).toBe('application/json');
      expect(merged['x-client-header']).toBe('client-value');
      expect(merged['x-static-header']).toBe('static-value');
      expect(merged['authorization']).toBe('Bearer upstream-token');
    });

    test('should prioritize static headers over client headers', () => {
      const clientHeaders = {
        'x-custom': 'client',
      };

      const staticHeaders = {
        'x-custom': 'static',
      };

      const merged = mergeUpstreamHeaders(clientHeaders, staticHeaders);

      expect(merged['x-custom']).toBe('static');
    });

    test('should handle undefined static headers', () => {
      const clientHeaders = {
        'x-custom': 'value',
      };

      const merged = mergeUpstreamHeaders(clientHeaders);

      expect(merged['x-custom']).toBe('value');
    });
  });

  describe('MCP key authentication', () => {
    test('rotates keys round robin per server', () => {
      const keys = [
        { id: 101, key: 'first' },
        { id: 102, key: 'second' },
      ];

      expect(selectMcpKeyRoundRobin(99, keys)?.key).toBe('first');
      expect(selectMcpKeyRoundRobin(99, keys)?.key).toBe('second');
      expect(selectMcpKeyRoundRobin(99, keys)?.key).toBe('first');
    });

    test('injects the selected key using the configured auth header', () => {
      expect(
        injectMcpKeyAuth({ 'X-Api-Key': 'old', accept: 'application/json' }, 'x-api-key', 'new')
      ).toEqual({
        accept: 'application/json',
        'x-api-key': 'new',
      });
    });
  });

  describe('redactSensitiveHeaders', () => {
    test('should redact sensitive headers', () => {
      const headers = {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
        cookie: 'session=abc123',
        'x-api-key': 'secret-key',
      };

      const redacted = redactSensitiveHeaders(headers);

      expect(redacted['content-type']).toBe('application/json');
      expect(redacted['authorization']).toBe('[REDACTED]');
      expect(redacted['cookie']).toBe('[REDACTED]');
      expect(redacted['x-api-key']).toBe('[REDACTED]');
    });
  });

  describe('extractJsonRpcMethod', () => {
    test('should extract method from JSON-RPC body', () => {
      const body = {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 1,
      };

      expect(extractJsonRpcMethod(body)).toBe('tools/list');
    });

    test('should return null for invalid body', () => {
      expect(extractJsonRpcMethod(null)).toBeNull();
      expect(extractJsonRpcMethod(undefined)).toBeNull();
      expect(extractJsonRpcMethod('string')).toBeNull();
      expect(extractJsonRpcMethod({})).toBeNull();
      expect(extractJsonRpcMethod({ jsonrpc: '2.0' })).toBeNull();
    });

    test('should handle nested objects', () => {
      const body = {
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
        },
      };

      expect(extractJsonRpcMethod(body)).toBe('initialize');
    });

    test('should inspect every request in a JSON-RPC batch', () => {
      const body = [
        { jsonrpc: '2.0', method: 'tools/list', id: 1 },
        { jsonrpc: '2.0', method: 'tools/call', id: 2 },
      ];

      expect(extractJsonRpcMethods(body)).toEqual(['tools/list', 'tools/call']);
      expect(extractJsonRpcMethod(body)).toBe('tools/list');
    });
  });

  describe('getMcpServerConfig', () => {
    beforeEach(() => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        failover: {
          enabled: false,
          retryableStatusCodes: [429, 500, 502, 503, 504],
          retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
        },
        quotas: [],
        mcpServers: {
          'test-server': {
            upstream_url: 'http://localhost:3000/mcp',
            enabled: true,
            headers: {
              'x-upstream-header': 'value',
            },
          },
          'disabled-server': {
            upstream_url: 'http://localhost:3001/mcp',
            enabled: false,
          },
          'local-server': {
            mode: 'local_http',
            enabled: true,
            launcher: 'bunx',
            package: '@example/mcp-server',
            args: ['--port', '{{PORT}}'],
            env: { API_KEY: 'test-key' },
            port: 7345,
            path: '/mcp',
          },
        },
      });
    });

    test('should return config for enabled server', () => {
      const config = getMcpServerConfig('test-server');

      expect(config).not.toBeNull();
      expect(config?.mode).not.toBe('local_http');
      if (config?.mode === 'local_http') throw new Error('Expected remote HTTP config');
      expect(config?.upstream_url).toBe('http://localhost:3000/mcp');
      expect(config?.enabled).toBe(true);
      expect(config?.headers).toEqual({ 'x-upstream-header': 'value' });
    });

    test('should return config and effective URL for local HTTP server', () => {
      const config = getMcpServerConfig('local-server');

      expect(config).not.toBeNull();
      expect(config?.mode).toBe('local_http');
      if (config?.mode !== 'local_http') throw new Error('Expected local HTTP config');
      expect(config.launcher).toBe('bunx');
      expect(config.package).toBe('@example/mcp-server');
      expect(config.env).toEqual({ API_KEY: 'test-key' });
      expect(getEffectiveUpstreamUrl(config)).toBe('http://127.0.0.1:7345/mcp');
    });

    test('should return null for disabled server', () => {
      const config = getMcpServerConfig('disabled-server');

      expect(config).toBeNull();
    });

    test('should return null for non-existent server', () => {
      const config = getMcpServerConfig('non-existent');

      expect(config).toBeNull();
    });

    test('should return null when mcpServers is not defined', () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        failover: {
          enabled: false,
          retryableStatusCodes: [429, 500, 502, 503, 504],
          retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
        },
        quotas: [],
      });

      const config = getMcpServerConfig('test-server');

      expect(config).toBeNull();
    });
  });

  describe('upstream response streaming', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    beforeEach(() => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        failover: {
          enabled: false,
          retryableStatusCodes: [429, 500, 502, 503, 504],
          retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
        },
        quotas: [],
        mcpServers: {
          'local-server': {
            mode: 'local_http',
            enabled: true,
            launcher: 'bunx',
            package: '@example/mcp-server',
            port: 7345,
            path: '/mcp',
          },
        },
      });
      registerSpy(mcpProcessManager, 'ensureRunning').mockResolvedValue(undefined);
    });

    test.each(['text/event-stream', 'TEXT/EVENT-STREAM;charset=utf-8'])(
      'returns an SSE response body as a stream for %s',
      async (contentType) => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response('data: {"jsonrpc":"2.0"}\n\n', {
            status: 200,
            headers: { 'content-type': contentType },
          })
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await proxyMcpRequest(
          'local-server',
          'POST',
          { accept: 'application/json, text/event-stream' },
          { jsonrpc: '2.0', method: 'tools/list', id: 1 }
        );

        expect(result.stream).toBeDefined();
        expect(result.body).toBeUndefined();
        await expect(new Response(result.stream).text()).resolves.toContain('jsonrpc');
      }
    );

    test('buffers a JSON GET response instead of treating it as SSE', async () => {
      const body = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'github_search_code',
              inputSchema: {
                type: 'object',
                properties: {
                  owner: { type: 'string', 'x-mcp-header': 'owner' },
                },
              },
            },
          ],
        },
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await proxyMcpRequest('local-server', 'GET', {
        accept: 'application/json, text/event-stream',
      });

      expect(result.stream).toBeUndefined();
      expect(result.body).toEqual(body);
    });
  });
});
