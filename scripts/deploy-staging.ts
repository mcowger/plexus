/**
 * Builds and deploys Plexus to a staging Docker host using Docker Compose.
 * The image is built by the remote Docker daemon; Compose is invoked on the
 * host so it can read its local Compose file.
 *
 * Required environment variables:
 *   PLEXUS_STAGING_DOCKER_CONTEXT   Docker context for the staging host
 *   PLEXUS_STAGING_URL              Public staging URL
 *   PLEXUS_STAGING_ADMIN_KEY        Admin API key for backups
 *
 * Optional environment variables:
 *   PLEXUS_STAGING_BACKUP_RETAIN    Number of local backups to keep (3)
 *   PLEXUS_STAGING_IMAGE_RETAIN     Number of timestamped images to keep (3)
 *   PLEXUS_STAGING_BACKUP_DIR       Local backup directory (.staging-backups)
 *   PLEXUS_STAGING_HEALTH_TIMEOUT   Health-check timeout in seconds (60)
 *   PLEXUS_TARGETPLATFORM           Docker target platform (linux/amd64)
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n❌ Required environment variable ${name} is not set.\n`);
    process.exit(1);
  }
  return value;
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
const SERVICE = 'plexus';
const LATEST_TAG = 'plexus:staging-latest';

type CommandResult = { success: boolean; stdout: string; stderr: string };

function run(
  command: string,
  args: string[],
  options: { fatal?: boolean; stream?: boolean } = {}
): CommandResult {
  const printable = [command, ...args].join(' ');
  console.log(`  $ ${printable}`);
  if (options.stream) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.status !== 0 && options.fatal !== false) {
      console.error(`\n❌ Command failed: ${printable}\n`);
      process.exit(1);
    }
    return { success: result.status === 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(command, args, { encoding: 'utf-8' });
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';
  if (result.status !== 0 && options.fatal !== false) {
    if (stderr) console.error(`  ${stderr}`);
    console.error(`\n❌ Command failed: ${printable}\n`);
    process.exit(1);
  }
  return { success: result.status === 0, stdout, stderr };
}

function docker(args: string[], options: { fatal?: boolean; stream?: boolean } = {}) {
  return run('docker', ['--context', CTX, ...args], options);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function step(number: number | string, label: string) {
  console.log(`\n── Phase ${number}: ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}`);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / 1024 ** index).toFixed(1))} ${['B', 'KB', 'MB', 'GB'][index]}`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inspectContainer(name: string): any | null {
  const result = docker(['inspect', '--format', '{{json .}}', name], { fatal: false });
  if (!result.success || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function findComposeContainer(service: string): string {
  const result = docker(
    [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.service=${service}`,
      '--format',
      '{{.Names}}',
    ],
    { fatal: false }
  );
  const names = result.stdout
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length !== 1) {
    console.error(
      `\n❌ Expected exactly one Compose container for service "${service}", found ${names.length}.\n`
    );
    process.exit(1);
  }
  return names[0]!;
}

function dockerContextSshHost(): string {
  const result = run('docker', [
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
    CTX,
  ]);
  const endpoint = result.stdout.replace(/^ssh:\/\//, '').split('/')[0];
  if (!endpoint) {
    console.error(`\n❌ Docker context ${CTX} does not use an SSH endpoint.\n`);
    process.exit(1);
  }
  return endpoint;
}

const now = new Date();
const TIMESTAMP = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
const NEW_TAG = `plexus:staging-${TIMESTAMP}`;
const SSH_HOST = dockerContextSshHost();

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║            Plexus Staging Deploy Script              ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`\n  Docker context:  ${CTX}`);
console.log(`  SSH host:        ${SSH_HOST}`);
console.log(`  Staging URL:     ${STAGING_URL}`);
console.log(`  New image tag:   ${NEW_TAG}`);

step(1, 'Inspect Compose container');
const containerName = findComposeContainer(SERVICE);
const before = inspectContainer(containerName);
if (!before) {
  console.error(`\n❌ Compose-managed container "${containerName}" was not found.\n`);
  process.exit(1);
}

const labels = before.Config?.Labels ?? {};
const project = labels['com.docker.compose.project'];
const workingDir = labels['com.docker.compose.project.working_dir'];
if (!project || !workingDir) {
  console.error('\n❌ Existing container is missing Compose project metadata.\n');
  process.exit(1);
}

const beforeId = before.Id;
const beforeImage = before.Image;
const previousImageRef = before.Config?.Image ?? LATEST_TAG;
console.log(`  Project:         ${project}`);
console.log(`  Working dir:     ${workingDir}`);
console.log(`  Container ID:    ${beforeId}`);
console.log(`  Image ID:        ${beforeImage}`);
console.log(`  Running:         ${before.State?.Running ? 'yes' : 'no'}`);

step(2, 'Backup');
let backupFile: string | null = null;
try {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(BACKUP_DIR, `backup-${TIMESTAMP}.tar.gz`);
  const response = await fetch(`${STAGING_URL}/v0/management/backup?full=true`, {
    headers: { 'x-admin-key': STAGING_ADMIN_KEY },
  });
  if (!response.ok || !response.body)
    throw new Error(`Backup request failed: ${response.status} ${response.statusText}`);
  const data = await response.arrayBuffer();
  await Bun.write(backupPath, data);
  backupFile = backupPath;
  console.log(`  ✓ Saved ${formatBytes(data.byteLength)} → ${backupPath}`);
  const backups = readdirSync(BACKUP_DIR)
    .filter((file) => file.startsWith('backup-') && file.endsWith('.tar.gz'))
    .map((file) => ({ file, mtime: statSync(join(BACKUP_DIR, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of backups.slice(BACKUP_RETAIN)) {
    unlinkSync(join(BACKUP_DIR, old.file));
    console.log(`  ✓ Pruned old backup: ${old.file}`);
  }
} catch (error) {
  console.warn(`  ⚠️  Backup failed (continuing): ${(error as Error).message}`);
}

step(3, 'Build on staging host');
docker(
  [
    'build',
    '--platform',
    TARGETPLATFORM,
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
  { stream: true }
);
console.log(`  ✓ Built ${NEW_TAG} and ${LATEST_TAG}`);

step(4, 'Recreate service with Compose');
const composeCommand = `cd -- ${shellQuote(workingDir)} && docker compose --project-name ${shellQuote(project)} up --detach --force-recreate ${shellQuote(SERVICE)}`;
run('ssh', [SSH_HOST, composeCommand]);

step(5, 'Verify replacement');
const after = inspectContainer(containerName);
if (!after || after.Id === beforeId || after.Image === beforeImage) {
  console.error('\n❌ Compose did not replace the container with a new image.');
  console.error(`  Before: ${beforeId} ${beforeImage}`);
  console.error(`  After:  ${after ? `${after.Id} ${after.Image}` : '(inspect failed)'}`);
  process.exit(1);
}
console.log(`  ✓ Container changed: ${beforeId} → ${after.Id}`);
console.log(`  ✓ Image changed:    ${beforeImage} → ${after.Image}`);

step(6, 'Prune old staging images');
const images = docker(['images', 'plexus', '--format', '{{.Tag}}\t{{.CreatedAt}}'], {
  fatal: false,
});
if (images.success && images.stdout) {
  const stagingImages = images.stdout
    .split('\n')
    .map((line) => {
      const [tag, ...created] = line.split('\t');
      return { tag: tag!, createdAt: created.join('\t') };
    })
    .filter(({ tag }) => tag.startsWith('staging-') && tag !== 'staging-latest')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const image of stagingImages.slice(IMAGE_RETAIN)) {
    const removed = docker(['rmi', `plexus:${image.tag}`], { fatal: false });
    if (removed.success) console.log(`  ✓ Removed plexus:${image.tag}`);
  }
}

step(7, 'Health check');
console.log(`  Polling ${STAGING_URL}/healthz (timeout: ${HEALTH_TIMEOUT}s)...`);
let healthy = false;
let elapsed = 0;
for (let attempt = 0; attempt < HEALTH_TIMEOUT; attempt++) {
  await sleep(1000);
  elapsed = attempt + 1;
  try {
    const response = await fetch(`${STAGING_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (response.ok && body?.ok === true) {
      healthy = true;
      break;
    }
  } catch {
    // The service may still be starting.
  }
  if (attempt % 10 === 9) console.log(`  ... still waiting (${elapsed}s)`);
}
if (!healthy) {
  console.error(`\n❌ Health check failed after ${HEALTH_TIMEOUT}s\n`);
  const logs = docker(['logs', '--tail', '50', containerName], { fatal: false });
  for (const line of `${logs.stdout}\n${logs.stderr}`.split('\n')) console.error(`    ${line}`);
  console.error(`\n  Rollback: docker --context ${CTX} tag ${previousImageRef} ${LATEST_TAG}`);
  process.exit(1);
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║                 ✅ Deploy Complete                   ║');
console.log('╚══════════════════════════════════════════════════════╝\n');
console.log(`  Previous image: ${previousImageRef}`);
console.log(`  Now live:       ${NEW_TAG}`);
console.log(`  Backup:         ${backupFile ?? '(skipped)'}`);
console.log(`  Health:         OK (${elapsed}s)`);
