#!/usr/bin/env bun
/**
 * Postinstall script that wraps `drizzle-kit` in node_modules/.bin to intercept
 * the `generate` subcommand. This ensures developers use
 * `bun run generate-migrations` instead of calling drizzle-kit generate directly
 * (which would produce random filenames).
 *
 * Cross-platform: writes shell wrappers on Unix and .cmd wrappers on Windows.
 */
import { existsSync, renameSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { platform } from 'node:os';

const isWindows = platform() === 'win32';

/** Find all node_modules/.bin/drizzle-kit paths under the project root. */
function findDrizzleKitBinaries(root: string): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') continue;

      const full = join(dir, entry.name);

      if (entry.name === 'node_modules') {
        const binDir = join(full, '.bin');
        if (existsSync(binDir)) {
          if (isWindows) {
            const cmd = join(binDir, 'drizzle-kit.cmd');
            if (existsSync(cmd)) results.push(cmd);
          } else {
            const sh = join(binDir, 'drizzle-kit');
            if (existsSync(sh)) results.push(sh);
          }
        }
        // Also recurse inside node_modules for workspace hoisting
        walk(full, depth + 1);
      } else {
        walk(full, depth + 1);
      }
    }
  }

  walk(root, 0);
  return results;
}

// Unix shell wrapper content
const UNIX_WRAPPER = `#!/usr/bin/env bash
# drizzle-kit wrapper — blocks 'generate' to enforce descriptive naming.
# Use 'bun run generate-migrations' instead of 'drizzle-kit generate'.

for arg in "$@"; do
  if [ "$arg" = "generate" ]; then
    echo "Error: Direct use of 'drizzle-kit generate' is not allowed." >&2
    echo "Use 'bun run generate-migrations' to generate migrations with descriptive naming." >&2
    exit 1
  fi
done

exec "$(dirname "$0")/drizzle-kit-real" "$@"
`;

// Windows .cmd wrapper content
const WINDOWS_WRAPPER = `@echo off
setlocal

for %%a in (%*) do if "%%a"=="generate" (
    echo Error: Direct use of 'drizzle-kit generate' is not allowed.
    echo Use 'bun run generate-migrations' to generate migrations with descriptive naming.
    exit /b 1
)

"%~dp0\\drizzle-kit-real.cmd" %*
`;

const wrapperContent = isWindows ? WINDOWS_WRAPPER : UNIX_WRAPPER;
const realSuffix = isWindows ? '-real.cmd' : '-real';

const rootDir = resolve(import.meta.dir, '..');
const binaries = findDrizzleKitBinaries(rootDir);

for (const binPath of binaries) {
  const binDir = dirname(binPath);
  const realPath = join(binDir, `drizzle-kit${realSuffix}`);

  // Already wrapped? Skip.
  if (existsSync(realPath)) {
    continue;
  }

  // Move the original binary aside
  renameSync(binPath, realPath);

  // Write the wrapper
  writeFileSync(binPath, wrapperContent, { mode: 0o755 });

  // Ensure executable on Unix
  if (!isWindows) {
    try {
      chmodSync(binPath, 0o755);
    } catch {
      // Some filesystems don't support chmod; that's okay
    }
  }
}
