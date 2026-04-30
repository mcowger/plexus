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
 *   PLEXUS_URL       Base URL of the Plexus instance  (default: http://localhost)
 *   PLEXUS_PORT      Port                             (default: 4000)
 *   PLEXUS_ADMIN_KEY Admin key                        (default: password)
 *
 * Data sources (applied in order — later entries win on name collision):
 *   scripts/default-populate.json   — committed default fixtures (no secrets)
 *   scripts/user-populate.json      — optional local overrides (git-ignored)
 */

import { join, basename } from 'path';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLEXUS_URL ?? 'http://localhost';
const ADMIN_KEY = process.env.PLEXUS_ADMIN_KEY ?? 'password';

// Mirrors the stable port derivation in scripts/dev.ts so this script targets
// the correct worktree instance without any configuration.
function deriveDevPort(): string {
  const dirName = basename(process.cwd());
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
}

const PORT = process.env.PLEXUS_PORT ?? deriveDevPort();

const API_ROOT = `${BASE_URL}:${PORT}`;

// ---------------------------------------------------------------------------
// Types mirroring the OpenAPI schemas
// ---------------------------------------------------------------------------

interface ProviderConfig {
  type: string;
  base_url?: string;
  api_key?: string;
  disable_cooldown?: boolean;
  gpu_ram_gb?: number;
  gpu_bandwidth_tb_s?: number;
  gpu_flops_tflop?: number;
  gpu_power_draw_watts?: number;
  [key: string]: unknown;
}

interface UserQuotaDefinition {
  type: 'rolling' | 'daily' | 'weekly';
  limitType: 'requests' | 'tokens';
  limit: number;
  duration?: string;
}

interface AliasTarget {
  provider: string;
  model: string;
}

interface AliasConfig {
  type:
    | 'chat'
    | 'messages'
    | 'responses'
    | 'gemini'
    | 'embeddings'
    | 'transcriptions'
    | 'speech'
    | 'image';
  targets: AliasTarget[];
  additional_aliases?: string[];
  input_price_per_million?: number;
  output_price_per_million?: number;
  metadata?: Record<string, unknown>;
  model_architecture?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
}

interface KeyConfig {
  secret: string;
  comment?: string;
  allowedProviders?: string[];
  allowedModels?: string[];
  quota?: string | null;
}

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

console.log('╔════════════════════════════════════════╗');
console.log('║       Plexus Dev Populate Script       ║');
console.log('╚════════════════════════════════════════╝');
console.log(`\n  Target:    ${API_ROOT}`);
console.log(
  `  Admin key: ${ADMIN_KEY.slice(0, 4)}${'*'.repeat(Math.max(0, ADMIN_KEY.length - 4))}`
);

// Connectivity
process.stdout.write('\n  Checking connectivity...');
await checkConnectivity();
console.log(' ok\n');

// Load data files
const scriptsDir = join(import.meta.dir);
const defaultFile = join(scriptsDir, 'default-populate.json');
const userFile = join(scriptsDir, 'user-populate.json');

const defaultData = await loadPopulateFile(defaultFile);
const userData = await loadPopulateFile(userFile);

if (!defaultData) {
  console.error(`  ✗  Could not load ${defaultFile}`);
  process.exit(1);
}

if (userData) {
  console.log('  ℹ  user-populate.json found — merging over defaults');
} else {
  console.log('  ℹ  No user-populate.json found — using defaults only');
}

const data = mergePopulateFiles(defaultData, userData);

const providerCount = Object.keys(data.providers ?? {}).length;
const quotaCount = Object.keys(data.quotas ?? {}).length;
const aliasCount = Object.keys(data.aliases ?? {}).length;
const keyCount = Object.keys(data.keys ?? {}).length;

console.log(
  `\n  Plan: ${providerCount} provider(s), ${quotaCount} quota(s), ${aliasCount} alias(es), ${keyCount} key(s)`
);
console.log('  Note: quotas must exist before keys that reference them\n');

// Seed — order matters: quotas before keys (referential integrity)
const providerResults = await seedProviders(data.providers ?? {});
const quotaResults = await seedQuotas(data.quotas ?? {});
const aliasResults = await seedAliases(data.aliases ?? {});
const keyResults = await seedKeys(data.keys ?? {});

// Report
console.log('\n──────────────────────────────────────────');
printSection('Providers', providerResults);
printSection('Quotas', quotaResults);
printSection('Aliases', aliasResults);
printSection('Keys', keyResults);

const allResults = [...providerResults, ...quotaResults, ...aliasResults, ...keyResults];
const totalOk = allResults.filter((r) => r.ok).length;
const totalErr = allResults.filter((r) => !r.ok).length;

console.log('\n──────────────────────────────────────────');
if (totalErr === 0) {
  console.log(
    `\n  ✓  Done! ${totalOk}/${allResults.length} resources created/updated successfully.\n`
  );
} else {
  console.log(`\n  ✗  Completed with errors: ${totalOk} ok, ${totalErr} failed.\n`);
  process.exit(1);
}
