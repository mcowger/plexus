import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureMcpServerDataDir,
  getMcpServerDataDir,
  removeMcpServerDataDir,
} from '../mcp-data-dir';

let temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots = [];
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plexus-mcp-data-'));
  temporaryRoots.push(root);
  return root;
}

describe('local MCP data directories', () => {
  test('creates a stable directory and preserves data across repeated provisioning', async () => {
    const root = await createRoot();
    const firstPath = await ensureMcpServerDataDir('weather', root);
    await writeFile(path.join(firstPath, 'state.json'), '{"saved":true}');

    const afterRestartPath = await ensureMcpServerDataDir('weather', root);

    expect(afterRestartPath).toBe(firstPath);
    expect(await Bun.file(path.join(afterRestartPath, 'state.json')).text()).toBe('{"saved":true}');
  });

  test('uses distinct non-user-controlled paths for different servers', async () => {
    const root = await createRoot();
    const firstPath = await ensureMcpServerDataDir('server-one', root);
    const secondPath = await ensureMcpServerDataDir('server-two', root);

    expect(secondPath).not.toBe(firstPath);
    expect(path.dirname(firstPath)).toBe(path.dirname(secondPath));
    expect(path.basename(firstPath)).toMatch(/^[a-f0-9]{64}$/);
    expect(getMcpServerDataDir('../outside', root)).toBe(
      path.join(path.resolve(root), createHash('sha256').update('../outside').digest('hex'))
    );
  });

  test('refuses a server directory symlink instead of following it', async () => {
    const root = await createRoot();
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await mkdir(path.join(root, 'mcp-servers'));
    const serverPath = getMcpServerDataDir('linked', path.join(root, 'mcp-servers'));
    await symlink(outside, serverPath);

    expect(() => ensureMcpServerDataDir('linked', path.join(root, 'mcp-servers'))).toThrow(
      'Local MCP data path is not a directory'
    );
  });

  test('does not change permissions on an existing root and secures the server directory', async () => {
    const root = await createRoot();
    await chmod(root, 0o750);
    const directory = await ensureMcpServerDataDir('private', root);
    await chmod(directory, 0o777);

    await ensureMcpServerDataDir('private', root);

    expect((await stat(root)).mode & 0o777).toBe(0o750);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  test('ignores an empty MCP_SERVERS_DATA_DIR and falls back to DATA_DIR', () => {
    const previousMcpRoot = process.env.MCP_SERVERS_DATA_DIR;
    const previousDataDir = process.env.DATA_DIR;
    process.env.MCP_SERVERS_DATA_DIR = '';
    process.env.DATA_DIR = '/tmp/plexus-data-root';
    try {
      expect(getMcpServerDataDir('fallback')).toBe(
        path.join(
          '/tmp/plexus-data-root',
          'mcp-servers',
          createHash('sha256').update('fallback').digest('hex')
        )
      );
    } finally {
      if (previousMcpRoot === undefined) delete process.env.MCP_SERVERS_DATA_DIR;
      else process.env.MCP_SERVERS_DATA_DIR = previousMcpRoot;
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
    }
  });

  test('removes a server data directory when the server is deleted', async () => {
    const root = await createRoot();
    const directory = await ensureMcpServerDataDir('removed', root);
    await writeFile(path.join(directory, 'state.json'), '{}');

    removeMcpServerDataDir('removed', root);

    expect(await stat(directory).catch(() => null)).toBeNull();
  });
});
