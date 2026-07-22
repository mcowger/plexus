import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { deriveDevPort } from '../dev-port-allocator';

describe('deriveDevPort', () => {
  const originalPort = process.env.PORT;

  beforeEach(() => {
    delete process.env.PORT;
  });

  afterEach(() => {
    if (originalPort !== undefined) {
      process.env.PORT = originalPort;
    } else {
      delete process.env.PORT;
    }
  });

  it('derives a deterministic port within 10000-19999 range based on directory path', () => {
    const cwd = '/workspace/plexus-worktree-a';
    const port = deriveDevPort(cwd);
    const num = Number(port);

    expect(num).toBeGreaterThanOrEqual(10000);
    expect(num).toBeLessThanOrEqual(19999);
    expect(deriveDevPort(cwd)).toBe(port);
  });

  it('respects process.env.PORT when set', () => {
    process.env.PORT = '4000';
    expect(deriveDevPort('/some/path')).toBe('4000');
  });
});

describe('dev-port-allocator executable', () => {
  const scriptPath = join(__dirname, '../dev-port-allocator.ts');

  it('outputs derived port when executed directly', () => {
    const output = execFileSync(
      'bun',
      ['run', scriptPath, 'dev', 'wks_1', 'main', '/workspace/my-app'],
      {
        encoding: 'utf8',
        env: { ...process.env, PORT: '' },
      }
    ).trim();

    const expected = deriveDevPort('/workspace/my-app');
    expect(output).toBe(expected);
  });

  it('uses PASEO_WORKTREE_PATH environment variable if present', () => {
    const output = execFileSync('bun', ['run', scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PORT: '',
        PASEO_WORKTREE_PATH: '/workspace/my-app-env',
      },
    }).trim();

    const expected = deriveDevPort('/workspace/my-app-env');
    expect(output).toBe(expected);
  });
});
