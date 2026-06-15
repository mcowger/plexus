/**
 * deploy-staging.ts
 *
 * Builds and deploys Plexus to a staging Docker host using a named Docker context.
 * No registry, no compose, no SSH keys to manage — everything goes through the Docker context.
 *
 * Usage:
 *   bun run deploy:staging
 *
 * Required environment variables:
 *   PLEXUS_STAGING_DOCKER_CONTEXT   Docker context name pointing at staging host (e.g. "dolphin")
 *   PLEXUS_STAGING_URL              Base URL of the staging instance (e.g. "http://staging.example.com:4000")
 *   PLEXUS_STAGING_ADMIN_KEY        Admin API key for the staging instance
 *
 * Optional environment variables:
 *   PLEXUS_STAGING_CONTAINER_NAME   Container to replace (default: "plexus")
 *   PLEXUS_STAGING_BACKUP_RETAIN    Number of local backup files to keep (default: 3)
 *   PLEXUS_STAGING_IMAGE_RETAIN     Number of staging images to keep on host (default: 3)
 *   PLEXUS_STAGING_BACKUP_DIR       Local directory for backup files (default: ".staging-backups")
 *   PLEXUS_STAGING_HEALTH_TIMEOUT   Seconds to wait for health check (default: 60)
 *   PLEXUS_TARGETPLATFORM           Docker target platform (default: "linux/amd64")
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`\n❌ Required environment variable ${name} is not set.\n`);
    process.exit(1);
  }
  return val;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

const CTX = requireEnv('PLEXUS_STAGING_DOCKER_CONTEXT');
const STAGING_URL = requireEnv('PLEXUS_STAGING_URL').replace(/\/$/, '');
const STAGING_ADMIN_KEY = requireEnv('PLEXUS_STAGING_ADMIN_KEY');
const BACKUP_RETAIN = parseInt(optionalEnv('PLEXUS_STAGING_BACKUP_RETAIN', '3'), 10);
const IMAGE_RETAIN = parseInt(optionalEnv('PLEXUS_STAGING_IMAGE_RETAIN', '3'), 10);
const BACKUP_DIR = optionalEnv('PLEXUS_STAGING_BACKUP_DIR', '.staging-backups');
const HEALTH_TIMEOUT = parseInt(optionalEnv('PLEXUS_STAGING_HEALTH_TIMEOUT', '60'), 10);
const TARGETPLATFORM = optionalEnv('PLEXUS_TARGETPLATFORM', 'linux/amd64');

function resolveContainerName(): string {
  const envName = process.env.PLEXUS_STAGING_CONTAINER_NAME;
  if (envName) return envName;

  const detectResult = spawnSync(
    'docker',
    [
      '--context',
      CTX,
      'ps',
      '-a',
      '--filter',
      'ancestor=plexus:staging-latest',
      '--format',
      '{{.Names}}',
    ],
    { encoding: 'utf-8' }
  );
  const detected = detectResult.stdout?.trim();
  if (detected) {
    const names = detected
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 1) return names[0]!;
    if (names.length > 1) {
      console.warn(`  ⚠️  Multiple containers match (plexus:staging-latest): ${names.join(', ')}`);
      console.warn(`     Using first: ${names[0]}`);
      return names[0]!;
    }
  }

  const fallbackResult = spawnSync(
    'docker',
    ['--context', CTX, 'ps', '-a', '--format', '{{.Names}}\t{{.Image}}'],
    { encoding: 'utf-8' }
  );
  const lines = (fallbackResult.stdout ?? '').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const [name, image] = line.split('\t');
    if (name && image?.startsWith('plexus:')) return name;
  }

  return 'Plexus';
}

const CONTAINER_NAME = resolveContainerName();

// Timestamp-based tag — works for uncommitted work, always sortable
const now = new Date();
const TIMESTAMP = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  '-',
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('');

const NEW_TAG = `plexus:staging-${TIMESTAMP}`;
const LATEST_TAG = 'plexus:staging-latest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function step(n: number, label: string) {
  console.log(`\n── Phase ${n}: ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}`);
}

/**
 * Run a docker command via the configured context.
 * Returns { success, stdout, stderr }.
 * On failure: if fatal=true, prints stderr and exits. Otherwise returns the result.
 * Pass stream=true to inherit stdio directly (e.g. for build output).
 */
function docker(
  args: string[],
  opts: { fatal?: boolean; silent?: boolean; stream?: boolean; env?: Record<string, string> } = {}
): { success: boolean; stdout: string; stderr: string } {
  const cmd = ['docker', '--context', CTX, ...args];
  if (!opts.silent) {
    console.log(`  $ ${cmd.join(' ')}`);
  }

  const env = opts.env ? { ...process.env, ...opts.env } : undefined;

  if (opts.stream) {
    const result = spawnSync(cmd[0]!, cmd.slice(1), { stdio: 'inherit', env });
    const success = result.status === 0;
    if (!success && opts.fatal !== false) {
      console.error(`\n❌ Command failed: ${cmd.join(' ')}\n`);
      process.exit(1);
    }
    return { success, stdout: '', stderr: '' };
  }

  const result = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf-8', env });
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';
  const success = result.status === 0;

  if (!success && opts.fatal !== false) {
    if (stderr) console.error(`  ${stderr}`);
    console.error(`\n❌ Command failed: ${cmd.join(' ')}\n`);
    process.exit(1);
  }
  return { success, stdout, stderr };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Phase 0: Announce
// ---------------------------------------------------------------------------

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║            Plexus Staging Deploy Script              ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log();
console.log(`  Docker context:  ${CTX}`);
console.log(`  Staging URL:     ${STAGING_URL}`);
console.log(
  `  Container:       ${CONTAINER_NAME}${process.env.PLEXUS_STAGING_CONTAINER_NAME ? '' : ' (auto-detected)'}`
);
console.log(`  Target platform: ${TARGETPLATFORM}`);
console.log(`  New image tag:   ${NEW_TAG}`);
console.log();

// ---------------------------------------------------------------------------
// Phase 1: Backup
// ---------------------------------------------------------------------------

step(1, 'Backup');

let backupFile: string | null = null;

try {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const backupTimestamp = TIMESTAMP;
  const backupPath = join(BACKUP_DIR, `backup-${backupTimestamp}.tar.gz`);

  console.log(`  Downloading full backup from ${STAGING_URL}...`);

  const res = await fetch(`${STAGING_URL}/v0/management/backup?full=true`, {
    headers: { 'x-admin-key': STAGING_ADMIN_KEY },
  });

  if (!res.ok || !res.body) {
    throw new Error(`Backup request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.arrayBuffer();
  await Bun.write(backupPath, data);
  backupFile = backupPath;

  console.log(`  ✓ Saved ${formatBytes(data.byteLength)} → ${backupPath}`);

  // Prune old backups
  const allBackups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.tar.gz'))
    .map((f) => ({
      name: f,
      path: join(BACKUP_DIR, f),
      mtime: statSync(join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = allBackups.slice(BACKUP_RETAIN);
  for (const f of toDelete) {
    unlinkSync(f.path);
    console.log(`  ✓ Pruned old backup: ${f.name}`);
  }
} catch (err: any) {
  console.warn(`  ⚠️  Backup failed (continuing): ${err.message}`);
}

// ---------------------------------------------------------------------------
// Phase 2: Capture previous image + print rollback command
// ---------------------------------------------------------------------------

step(2, 'Inspect running container');

const inspectResult = docker(['inspect', '--format', '{{json .}}', CONTAINER_NAME], {
  fatal: false,
  silent: true,
});

let previousImage: string | null = null;
let rollbackCommand: string | null = null;

if (inspectResult.success && inspectResult.stdout) {
  let info: any;
  try {
    info = JSON.parse(inspectResult.stdout);
  } catch {
    console.warn('  ⚠️  Could not parse docker inspect output');
  }

  if (info) {
    previousImage = info.Config?.Image ?? null;

    const parts: string[] = [`docker --context ${CTX} run -d`];
    parts.push(`  --name ${CONTAINER_NAME}`);

    const restartPolicy = info.HostConfig?.RestartPolicy?.Name;
    if (restartPolicy && restartPolicy !== 'no') {
      const maxRetries = info.HostConfig.RestartPolicy.MaximumRetryCount;
      const policyStr =
        restartPolicy === 'on-failure' && maxRetries ? `on-failure:${maxRetries}` : restartPolicy;
      parts.push(`  --restart ${policyStr}`);
    }

    const portBindings = info.HostConfig?.PortBindings ?? {};
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      for (const binding of (bindings as any[]) ?? []) {
        const hostPart = binding.HostIp
          ? `${binding.HostIp}:${binding.HostPort}`
          : binding.HostPort;
        parts.push(`  -p ${hostPart}:${containerPort.replace('/tcp', '').replace('/udp', '')}`);
      }
    }

    const mounts = info.Mounts ?? [];
    for (const m of mounts) {
      if (m.Type === 'bind') {
        const ro = m.RW === false ? ':ro' : '';
        parts.push(`  -v ${m.Source}:${m.Destination}${ro}`);
      } else if (m.Type === 'volume') {
        const ro = m.RW === false ? ':ro' : '';
        parts.push(`  -v ${m.Name}:${m.Destination}${ro}`);
      }
    }

    const skipEnvPrefixes = ['PATH=', 'HOSTNAME=', 'HOME='];
    const envVars: string[] = info.Config?.Env ?? [];
    for (const e of envVars) {
      if (!skipEnvPrefixes.some((p) => e.startsWith(p))) {
        parts.push(`  -e "${e}"`);
      }
    }

    parts.push(`  ${previousImage}`);
    rollbackCommand = parts.join(' ');

    console.log(`  Previous image: ${previousImage}`);
    console.log();
    console.log('  ⚠️  Rollback command (save this before continuing):');
    console.log(`    ${rollbackCommand}`);
    console.log();
  }
} else {
  console.log(`  Container "${CONTAINER_NAME}" not currently running — clean deploy.`);
}

// ---------------------------------------------------------------------------
// Phase 3: Build on staging host
// ---------------------------------------------------------------------------

step(3, 'Build on staging host');

console.log(`  Building ${NEW_TAG} on context "${CTX}"...`);
docker(
  [
    'build',
    '--build-arg',
    `APP_VERSION=${TIMESTAMP}`,
    '--build-arg',
    `TARGETPLATFORM=${TARGETPLATFORM}`,
    '-t',
    NEW_TAG,
    '-t',
    LATEST_TAG,
    '.',
  ],
  {
    fatal: true,
    stream: true,
    // DOCKER_BUILDKIT=1 enables BuildKit on the remote daemon so it
    // injects TARGETPLATFORM natively (in addition to our --build-arg).
    // The build still runs on the remote host via the Docker context.
    env: { DOCKER_BUILDKIT: '1' },
  }
);
console.log(`  ✓ Built ${NEW_TAG}`);

// ---------------------------------------------------------------------------
// Phase 4: Deploy via Watchtower --run-once --no-pull
// ---------------------------------------------------------------------------

step(4, 'Deploy via Watchtower --run-once --no-pull');

docker(
  [
    'run',
    '--rm',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    'containrrr/watchtower',
    '--run-once',
    '--no-pull',
    CONTAINER_NAME,
  ],
  { fatal: true }
);
console.log(`  ✓ Watchtower restarted ${CONTAINER_NAME} with new image`);

// ---------------------------------------------------------------------------
// Phase 5: Prune old images on host
// ---------------------------------------------------------------------------

step(5, 'Prune old staging images on host');

const imagesResult = docker(['images', 'plexus', '--format', '{{.Tag}}\t{{.CreatedAt}}'], {
  fatal: false,
  silent: true,
});

if (imagesResult.success && imagesResult.stdout) {
  const stagingImages = imagesResult.stdout
    .split('\n')
    .map((line) => {
      const [tag, ...rest] = line.split('\t');
      return { tag: tag!, createdAt: rest.join('\t') };
    })
    .filter(({ tag }) => tag.startsWith('staging-') && tag !== 'staging-latest')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const toRemove = stagingImages.slice(IMAGE_RETAIN);
  if (toRemove.length > 0) {
    for (const img of toRemove) {
      const rmResult = docker(['rmi', `plexus:${img.tag}`], { fatal: false });
      if (rmResult.success) {
        console.log(`  ✓ Removed plexus:${img.tag}`);
      } else {
        console.warn(`  ⚠️  Could not remove plexus:${img.tag} (may be in use)`);
      }
    }
  } else {
    console.log(`  ✓ No images to prune (${stagingImages.length} staging image(s) on host)`);
  }
}

// ---------------------------------------------------------------------------
// Phase 6: Health check
// ---------------------------------------------------------------------------

step(6, 'Health check');

console.log(`  Polling ${STAGING_URL}/health (timeout: ${HEALTH_TIMEOUT}s)...`);

let healthy = false;
let elapsed = 0;

for (let i = 0; i < HEALTH_TIMEOUT; i++) {
  await sleep(1000);
  elapsed = i + 1;
  try {
    const res = await fetch(`${STAGING_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    if (res.ok && body.trim() === 'OK') {
      healthy = true;
      break;
    }
  } catch {
    // not ready yet
  }
  if (i % 10 === 9) {
    console.log(`  ... still waiting (${elapsed}s)`);
  }
}

if (!healthy) {
  console.error(`\n❌ Health check failed after ${HEALTH_TIMEOUT}s\n`);
  console.error('  Last container logs:');
  const logsResult = docker(['logs', '--tail', '50', CONTAINER_NAME], {
    fatal: false,
    silent: true,
  });
  const logLines = (logsResult.stdout + logsResult.stderr).split('\n');
  for (const line of logLines) console.error(`    ${line}`);

  if (rollbackCommand) {
    console.error('\n  Manual rollback command:');
    console.error(
      `    docker --context ${CTX} stop ${CONTAINER_NAME} && docker --context ${CTX} rm ${CONTAINER_NAME}`
    );
    console.error(`    Then: ${rollbackCommand}`);
  }
  process.exit(1);
}

console.log(`  ✓ Healthy (${elapsed}s)`);

// ---------------------------------------------------------------------------
// Phase 7: Summary
// ---------------------------------------------------------------------------

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║                 ✅ Deploy Complete                   ║');
console.log('╚══════════════════════════════════════════════════════╝\n');
console.log(`  Previous:   ${previousImage ?? '(none)'}`);
console.log(`  Now live:   ${NEW_TAG}`);
console.log(`  Backup:     ${backupFile ?? '(skipped)'}`);
console.log(`  Health:     OK (${elapsed}s)`);
console.log(`  URL:        ${STAGING_URL}`);

if (rollbackCommand) {
  console.log('\n  Rollback if needed:');
  console.log(
    `    docker --context ${CTX} stop ${CONTAINER_NAME} && docker --context ${CTX} rm ${CONTAINER_NAME}`
  );
  console.log(`    Then: ${rollbackCommand}`);
}

console.log();
