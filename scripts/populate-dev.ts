/**
 * populate-dev.ts
 *
 * Seeds a running Plexus instance with a realistic baseline configuration for
 * development and testing. Does NOT require any real external API credentials
 * by default — all providers point at local or mock endpoints.
 *
 * Usage:
 *   bun run scripts/populate-dev.ts
 *
 * Environment variables (all optional — defaults match `bun run dev` defaults):
 *   PLEXUS_URL       Complete Plexus origin, or a hostname to combine with PLEXUS_PORT
 *   PLEXUS_PORT      Port (default: worktree-derived when PLEXUS_URL is unset)
 *   PLEXUS_ADMIN_KEY Admin key                        (default: password)
 *
 * Data sources (applied in order — later entries win on name collision):
 *   scripts/default-populate.json   — committed default fixtures (no secrets)
 *   scripts/user-populate.json      — optional local overrides (git-ignored)
 */

import { join, basename } from 'path';
import type { components } from './openapi-types';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const ADMIN_KEY = process.env.PLEXUS_ADMIN_KEY ?? 'password';

// Mirrors the stable port derivation in scripts/dev.ts so this script targets
// the correct worktree instance without any configuration.
export function deriveDevPort(cwd = process.cwd()): string {
  const dirName = basename(cwd);
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
}

export function resolveApiRoot(
  env: Pick<NodeJS.ProcessEnv, 'PLEXUS_URL' | 'PLEXUS_PORT'> = process.env,
  cwd = process.cwd()
): string {
  const configuredUrl = env.PLEXUS_URL ?? 'http://localhost';
  const url = new URL(configuredUrl.includes('://') ? configuredUrl : `http://${configuredUrl}`);
  if (!url.port) {
    const port = env.PLEXUS_PORT ?? (env.PLEXUS_URL ? undefined : deriveDevPort(cwd));
    if (port) url.port = port;
  }
  return url.origin;
}

const API_ROOT = resolveApiRoot();

// ---------------------------------------------------------------------------
// Types directly from the OpenAPI schemas
// ---------------------------------------------------------------------------

type ProviderConfig = components['schemas']['ProviderConfig'];
type UserQuotaDefinition = components['schemas']['UserQuotaDefinition'];
type AliasConfig = components['schemas']['AliasConfig'];
type KeyConfig = components['schemas']['KeyConfig'];

interface PopulateFile {
  providers?: Record<string, ProviderConfig>;
  quotas?: Record<string, UserQuotaDefinition>;
  aliases?: Record<string, AliasConfig>;
  keys?: Record<string, KeyConfig>;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const adminHeaders = {
  'Content-Type': 'application/json',
  'x-admin-key': ADMIN_KEY,
};

async function apiPut(
  path: string,
  body: unknown
): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${API_ROOT}${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// ---------------------------------------------------------------------------
// Load and merge populate files
// ---------------------------------------------------------------------------

async function loadPopulateFile(filePath: string): Promise<PopulateFile | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    const raw = await file.text();
    return JSON.parse(raw) as PopulateFile;
  } catch (err) {
    console.error(
      `  ⚠  Failed to load ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

function mergePopulateFiles(...sources: (PopulateFile | null)[]): PopulateFile {
  const merged: PopulateFile = {
    providers: {},
    quotas: {},
    aliases: {},
    keys: {},
  };
  for (const source of sources) {
    if (!source) continue;
    if (source.providers) Object.assign(merged.providers!, source.providers);
    if (source.quotas) Object.assign(merged.quotas!, source.quotas);
    if (source.aliases) Object.assign(merged.aliases!, source.aliases);
    if (source.keys) Object.assign(merged.keys!, source.keys);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Seeding functions
// ---------------------------------------------------------------------------

type Result = { name: string; ok: boolean; status: number; detail?: string };

async function seedProviders(providers: Record<string, ProviderConfig>): Promise<Result[]> {
  const results: Result[] = [];
  for (const [slug, config] of Object.entries(providers)) {
    const { ok, status, text } = await apiPut(
      `/v0/management/providers/${encodeURIComponent(slug)}`,
      config
    );
    results.push({ name: slug, ok, status, detail: ok ? undefined : text });
  }
  return results;
}

async function seedQuotas(quotas: Record<string, UserQuotaDefinition>): Promise<Result[]> {
  const results: Result[] = [];
  for (const [name, definition] of Object.entries(quotas)) {
    const { ok, status, text } = await apiPut(
      `/v0/management/user-quotas/${encodeURIComponent(name)}`,
      definition
    );
    results.push({ name, ok, status, detail: ok ? undefined : text });
  }
  return results;
}

async function seedAliases(aliases: Record<string, AliasConfig>): Promise<Result[]> {
  const results: Result[] = [];
  for (const [slug, config] of Object.entries(aliases)) {
    const { ok, status, text } = await apiPut(
      `/v0/management/aliases/${encodeURIComponent(slug)}`,
      config
    );
    results.push({ name: slug, ok, status, detail: ok ? undefined : text });
  }
  return results;
}

async function seedKeys(keys: Record<string, KeyConfig>): Promise<Result[]> {
  const results: Result[] = [];
  for (const [name, config] of Object.entries(keys)) {
    const { ok, status, text } = await apiPut(
      `/v0/management/keys/${encodeURIComponent(name)}`,
      config
    );
    results.push({ name, ok, status, detail: ok ? undefined : text });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printSection(label: string, results: Result[]): void {
  const ok = results.filter((r) => r.ok).length;
  const err = results.filter((r) => !r.ok).length;
  const icon = err === 0 ? '✓' : '✗';
  console.log(`\n  ${icon}  ${label}: ${ok} ok${err > 0 ? `, ${err} failed` : ''}`);
  for (const r of results) {
    if (r.ok) {
      console.log(`       ✓  ${r.name}`);
    } else {
      console.log(`       ✗  ${r.name} [${r.status}] ${r.detail ?? ''}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------

async function checkConnectivity(): Promise<void> {
  const healthUrl = `${API_ROOT}/health`;
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error(`  ✗  Health check failed: HTTP ${res.status} from ${healthUrl}`);
      console.error('     Is the Plexus server running? Try: bun run dev');
      process.exit(1);
    }
  } catch (err) {
    console.error(`  ✗  Cannot reach Plexus at ${healthUrl}`);
    console.error(`     ${err instanceof Error ? err.message : String(err)}`);
    console.error('\n     Is the server running? Try: bun run dev');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════╗');
  console.log('║       Plexus Dev Populate Script       ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n  Target:    ${API_ROOT}`);
  console.log(
    `  Admin key: ${ADMIN_KEY.slice(0, 4)}${'*'.repeat(Math.max(0, ADMIN_KEY.length - 4))}`
  );

  process.stdout.write('\n  Checking connectivity...');
  await checkConnectivity();
  console.log(' ok\n');

  const scriptsDir = join(import.meta.dir);
  const defaultFile = join(scriptsDir, 'default-populate.json');
  const userFile = join(scriptsDir, 'user-populate.json');
  const defaultData = await loadPopulateFile(defaultFile);
  const userData = await loadPopulateFile(userFile);

  if (!defaultData) {
    console.error(`  ✗  Could not load ${defaultFile}`);
    process.exit(1);
  }
  console.log(
    userData
      ? '  ℹ  user-populate.json found — merging over defaults'
      : '  ℹ  No user-populate.json found — using defaults only'
  );

  const data = mergePopulateFiles(defaultData, userData);
  const providerCount = Object.keys(data.providers ?? {}).length;
  const quotaCount = Object.keys(data.quotas ?? {}).length;
  const aliasCount = Object.keys(data.aliases ?? {}).length;
  const keyCount = Object.keys(data.keys ?? {}).length;
  console.log(
    `\n  Plan: ${providerCount} provider(s), ${quotaCount} quota(s), ${aliasCount} alias(es), ${keyCount} key(s)`
  );
  console.log('  Note: quotas must exist before keys that reference them\n');

  const completedResults: Result[] = [];
  const seedStage = async (label: string, seed: () => Promise<Result[]>): Promise<boolean> => {
    const results = await seed();
    completedResults.push(...results);
    printSection(label, results);
    return results.every((result) => result.ok);
  };

  console.log('\n──────────────────────────────────────────');
  if (!(await seedStage('Providers', () => seedProviders(data.providers ?? {})))) {
    console.error('\n  ✗  Stopped before seeding dependent aliases and keys.\n');
    process.exit(1);
  }
  if (!(await seedStage('Quotas', () => seedQuotas(data.quotas ?? {})))) {
    console.error('\n  ✗  Stopped before seeding aliases and quota-dependent keys.\n');
    process.exit(1);
  }
  if (!(await seedStage('Aliases', () => seedAliases(data.aliases ?? {})))) {
    console.error('\n  ✗  Stopped before seeding keys.\n');
    process.exit(1);
  }
  if (!(await seedStage('Keys', () => seedKeys(data.keys ?? {})))) {
    console.error('\n  ✗  Key seeding failed.\n');
    process.exit(1);
  }

  console.log('\n──────────────────────────────────────────');
  console.log(
    `\n  ✓  Done! ${completedResults.length}/${completedResults.length} resources created/updated successfully.\n`
  );
}

if (import.meta.main) await main();
