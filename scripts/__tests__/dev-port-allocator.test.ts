import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { getPaseoPort } from '../dev-config';
import { deriveDevPort } from '../dev-port-allocator';

// deriveDevPort respects process.env.PORT, so scrub it for every test in
// this file — otherwise the expected values depend on the ambient
// environment (e.g. a PORT set by Paseo for this very service).
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

describe('deriveDevPort', () => {
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

  // The allocator prefers PASEO_* env vars over argv by design, so the child
  // must not inherit them (or PORT) from the ambient environment — otherwise
  // the derived port depends on where the test itself runs (e.g. under Paseo).
  function childEnv(extra: Record<string, string> = {}): Record<string, string> {
    const {
      PASEO_WORKTREE_PATH: _worktreePath,
      PASEO_SCRIPTNAME: _scriptName,
      PORT: _port,
      ...rest
    } = process.env;
    return { ...rest, ...extra };
  }

  it('outputs derived port when executed directly', () => {
    const output = execFileSync(
      'bun',
      ['run', scriptPath, 'dev', 'wks_1', 'main', '/workspace/my-app'],
      {
        encoding: 'utf8',
        env: childEnv(),
      }
    ).trim();

    const expected = deriveDevPort('/workspace/my-app', 'dev');
    expect(output).toBe(expected);
  });

  it('uses PASEO_WORKTREE_PATH environment variable if present', () => {
    const output = execFileSync('bun', ['run', scriptPath], {
      encoding: 'utf8',
      env: childEnv({ PASEO_WORKTREE_PATH: '/workspace/my-app-env' }),
    }).trim();

    const expected = deriveDevPort('/workspace/my-app-env');
    expect(output).toBe(expected);
  });
});

describe('Paseo port selection', () => {
  it('uses a running dev service instead of a stopped preferred service', () => {
    expect(
      getPaseoPort('dev:full', (scriptName) =>
        scriptName === 'dev' ? { port: 11735 } : { port: null }
      )
    ).toBe('11735');
  });
});
