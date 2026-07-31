import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  discoverOperations,
  formatOutput,
  isRisky,
  parseArgs,
  run,
  type Json,
  type Operation,
} from '../cli';

const document = {
  paths: {
    '/v0/management/keys/{id}': {
      delete: {
        operationId: 'deleteKey',
        parameters: [{ name: 'id', in: 'path', required: true }],
      },
      get: { operationId: 'getKey', tags: ['Keys'] },
    },
    '/v0/system/logs/stream': {
      get: {
        operationId: 'streamLogs',
        responses: { 200: { content: { 'text/event-stream': {} } } },
      },
    },
    '/v1/models': { get: { operationId: 'listModels' } },
  },
};

describe('dynamic OpenAPI routing', () => {
  it('limits discovery to supported non-stream operations', () => {
    expect(discoverOperations(document).map((operation) => operation.id)).toEqual([
      'deleteKey',
      'getKey',
    ]);
  });

  it('builds encoded path and query parameters', () => {
    const operation: Operation = {
      id: 'get',
      method: 'get',
      path: '/v0/management/items/{id}',
      operation: {
        parameters: [
          { name: 'id', in: 'path', required: true },
          { name: 'limit', in: 'query' },
        ],
      },
    };
    const request = buildRequest(
      operation,
      new Map([
        ['id', 'a/b' as Json],
        ['limit', 10 as Json],
      ])
    );
    expect(request.url).toBe('/v0/management/items/a%2Fb?limit=10');
  });

  it('recognizes destructive operations', () => {
    expect(isRisky(discoverOperations(document)[0]!)).toBe(true);
  });
});

describe('arguments and output', () => {
  it('uses environment defaults and coerces JSON literal parameters', () => {
    const args = parseArgs(['api', 'call', 'getKey', '--param', 'limit=10'], {
      PLEXUS_URL: 'http://plexus',
    });
    expect(args.url).toBe('http://plexus');
    expect(args.params.get('limit')).toBe(10);
  });

  it('parses the all-pages flag', () => {
    expect(parseArgs(['api', 'call', 'getKey', '--all'], {}).all).toBe(true);
  });

  it('formats tables with deterministic columns', () => {
    expect(formatOutput([{ b: 2, a: 'one' }], 'table')).toBe('a    b\n---  -\none  2\n');
  });
});

describe('execution', () => {
  it('fetches the schema without caching and uses JSON for non-TTY output', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let stdout = '';
    const exitCode = await run(
      ['api', 'call', 'getKey'],
      {},
      {
        fetch: async (url, init) => {
          requests.push({ url: String(url), init });
          return requests.length === 1
            ? new Response(JSON.stringify(document))
            : new Response(JSON.stringify({ value: true }));
        },
        stdin: async () => '',
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
        isTTY: false,
        confirm: async () => false,
      }
    );
    expect(exitCode).toBe(0);
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:4000/.well-known/plexus/openapi.json',
      init: { cache: 'no-store' },
    });
    expect(stdout).toBe('{\n  "value": true\n}\n');
  });

  it('sends the management credential with x-admin-key', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const exitCode = await run(
      ['api', 'call', 'getKey', '--admin-key', 'secret'],
      {},
      {
        fetch: async (url, init) => {
          requests.push({ url: String(url), init });
          return requests.length === 1
            ? new Response(JSON.stringify(document))
            : new Response(JSON.stringify({ value: true }));
        },
        stdin: async () => '',
        stdout: () => {},
        stderr: () => {},
        isTTY: false,
        confirm: async () => false,
      }
    );
    expect(exitCode).toBe(0);
    expect(new Headers(requests[1]?.init?.headers).get('x-admin-key')).toBe('secret');
  });

  it('retrieves all standardized pages', async () => {
    const paginatedDocument = {
      paths: {
        '/v0/management/items': {
          get: {
            operationId: 'listItems',
            parameters: [
              { name: 'limit', in: 'query' },
              { name: 'offset', in: 'query' },
            ],
          },
        },
      },
    };
    let stdout = '';
    const exitCode = await run(
      ['api', 'call', 'listItems', '--all', '--param', 'limit=2'],
      {},
      {
        fetch: async (url) => {
          if (String(url).includes('openapi.json'))
            return new Response(JSON.stringify(paginatedDocument));
          return String(url).includes('offset=2')
            ? new Response(JSON.stringify({ data: [3], total: 3, limit: 2, offset: 2 }))
            : new Response(JSON.stringify({ data: [1, 2], total: 3, limit: 2, offset: 0 }));
        },
        stdin: async () => '',
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
        isTTY: false,
        confirm: async () => true,
      }
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ data: [1, 2, 3], total: 3 });
  });
});
