import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

const openApiDocument = {
  openapi: '3.1.0',
  paths: {
    '/v0/management/usage': {
      get: {
        operationId: 'getV0ManagementUsage',
        parameters: [
          { name: 'limit', in: 'query' },
          { name: 'offset', in: 'query' },
        ],
        responses: {
          200: {
            content: {
              'application/json': {},
            },
          },
        },
      },
    },
  },
};

describe('plexuscli end-to-end', () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  const buildDir = join(tmpdir(), `plexuscli-e2e-${crypto.randomUUID()}`);
  let cliPath: string;

  beforeAll(async () => {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), 'src', 'index.ts')],
      outdir: buildDir,
      compile: true,
      target: 'bun',
    });
    if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
    cliPath = result.outputs[0]!.path;
  });

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  afterAll(async () => {
    await rm(buildDir, { force: true, recursive: true });
  });

  test('discovers and calls a paginated management operation', async () => {
    const adminKeys: string[] = [];
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/.well-known/plexus/openapi.json') {
          return Response.json(openApiDocument);
        }

        if (url.pathname === '/v0/management/usage') {
          adminKeys.push(request.headers.get('x-admin-key') ?? '');
          const offset = Number(url.searchParams.get('offset') ?? '0');
          return Response.json(
            offset === 0
              ? { data: [{ requestId: 'one' }], total: 2, limit: 1, offset }
              : { data: [{ requestId: 'two' }], total: 2, limit: 1, offset }
          );
        }

        return new Response('Not Found', { status: 404 });
      },
    });

    const child = Bun.spawn(
      [
        cliPath,
        '--url',
        `http://localhost:${server.port}`,
        '--admin-key',
        'e2e-admin-key',
        'api',
        'call',
        'getV0ManagementUsage',
        '--all',
        '--param',
        'limit=1',
        '--output',
        'json',
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toMatchObject({
      data: [{ requestId: 'one' }, { requestId: 'two' }],
      total: 2,
    });
    expect(adminKeys).toEqual(['e2e-admin-key', 'e2e-admin-key']);
  });
});
