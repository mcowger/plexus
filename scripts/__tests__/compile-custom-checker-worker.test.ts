import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Guards the release build config, not the runtime.
 *
 * `bun build --compile` only embeds a worker if it is listed as an entrypoint,
 * and `new Worker(new URL('./custom-checker-worker.ts', import.meta.url))`
 * resolves against the embedded entry root. Without both the entrypoint and
 * `--entry-naming="[name].[ext]"`, every compiled release throws
 * `ModuleNotFound resolving "/$bunfs/root/custom-checker-worker.ts"` from the
 * custom quota checker test endpoint (see issue #1013).
 */
const WORKER_ENTRY = 'packages/backend/src/services/quota/custom-checker-worker.ts';

/** Scripts that compile the backend into a standalone executable. */
const BACKEND_COMPILE_SCRIPTS = [
  'build:bin',
  'compile:macos',
  'compile:linux-amd64',
  'compile:linux-arm64',
] as const;

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const packageJsonPath = join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
      if (parsed.name === 'plexus2') return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Could not locate repository root from ${start}`);
    dir = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('compiled builds embed the custom checker worker', () => {
  for (const scriptName of BACKEND_COMPILE_SCRIPTS) {
    it(`${scriptName} lists the worker entrypoint and flattens entry names`, () => {
      const script = packageJson.scripts[scriptName];
      expect(script).toBeDefined();
      expect(script).toContain(WORKER_ENTRY);
      expect(script).toContain('--entry-naming="[name].[ext]"');
      // The main entry must stay first so it remains the executable's entry.
      expect(script.indexOf('packages/backend/src/index.ts')).toBeLessThan(
        script.indexOf(WORKER_ENTRY)
      );
    });
  }

  it('compile:windows goes through scripts/compile-windows.ts with the same flags', () => {
    expect(packageJson.scripts['compile:windows']).toContain('scripts/compile-windows.ts');

    const windowsScript = readFileSync(join(repoRoot, 'scripts/compile-windows.ts'), 'utf8');
    expect(windowsScript).toContain(`resolve('${WORKER_ENTRY}')`);
    expect(windowsScript).toContain("'--entry-naming=[name].[ext]'");
  });
});
