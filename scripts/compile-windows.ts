import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

const target = process.argv[2];
const outfile = process.argv[3];

if (!target || !outfile) {
  console.error('Usage: bun run scripts/compile-windows.ts <target> <outfile>');
  process.exit(1);
}

function buildFrontendIfNeeded() {
  const frontendDistFiles = [
    'packages/frontend/dist/index.html',
    'packages/frontend/dist/main.js',
    'packages/frontend/dist/main.css',
  ];

  if (frontendDistFiles.every((file) => existsSync(resolve(file)))) return;

  const fb = spawnSync(process.execPath, ['run', 'build'], {
    cwd: resolve('packages/frontend'),
    stdio: 'inherit',
  });
  if (fb.status !== 0) process.exit(fb.status ?? 1);
}

buildFrontendIfNeeded();

function files(dir: string, ext: string): string[] {
  const d = resolve(dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(ext))
    .map((f) => resolve(d, f));
}

const args = [
  'build',
  resolve('packages/backend/src/index.ts'),
  ...files('packages/backend/drizzle/migrations', '.sql'),
  ...files('packages/backend/drizzle/migrations_pg', '.sql'),
  ...files('packages/frontend/dist', '.png'),
  ...files('packages/frontend/dist', '.ico'),
  ...files('packages/frontend/dist', '.svg'),
  ...files('packages/frontend/dist', '.webmanifest'),
  '--compile',
  '--asset-naming=[name].[ext]',
  `--target=${target}`,
  `--outfile=${outfile}`,
];

console.log(`Compiling ${target} -> ${outfile} (${args.length} args)`);

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(result.status ?? 1);
