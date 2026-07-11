import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const LOCAL_MOCK_ORIGIN = 'http://localhost:4010';

export function generateMockKey(providerName: string, originalKey: string): string {
  if (originalKey === 'oauth') return 'oauth';
  if (originalKey.startsWith('eyJhbGciOiJIUzI1Ni')) {
    // JWT token
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbnYiOiJwcm9kdWN0aW9uIiwia2lsb1VzZXJJZCI6Im9hdXRoL2dvb2dsZToxMDQyOTkwNDU4Mzg1MTUzMTQyMjciLCJhcGlUb2tlblBlcHBlciI6bnVsbCwidmVyc2lvbiI6MywiaWF0IjoxNzc1NTE3MzMwLCJleHAiOjE5MzMxOTczMzB9.mock-signature';
  }
  if (originalKey.startsWith('sk-proj-')) {
    return 'sk-proj-mock-openai-project-key-0000000000000000000000000000000000000000';
  }
  if (originalKey.startsWith('sk-or-v1-')) {
    return 'sk-or-v1-mock-openrouter-key-0000000000000000000000000000000000000000000';
  }
  if (originalKey.startsWith('sk-ant-')) {
    return 'sk-ant-api03-mock-anthropic-key-000000000000000000000000000000000000000000000';
  }
  if (originalKey.startsWith('AIzaSy')) {
    return 'AIzaSyAD_mock-google-key-0000000000000000000000000000000';
  }
  if (originalKey.startsWith('sk-svcacct-')) {
    return 'sk-svcacct-mock-openai-service-key-0000000000000000000000000000000000000000';
  }
  return `sk-mock-${providerName}-key-00000000000000000000000000000000`;
}

/**
 * Recursively removes null values from objects, converting them to undefined (which omits them in JSON serialization).
 * This ensures compatibility with Zod's .optional() schemas which reject nulls but accept omitted/undefined.
 */
export function cleanNulls(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    return obj.map(cleanNulls).filter((v) => v !== undefined);
  }
  if (typeof obj === 'object') {
    const res: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = cleanNulls(v);
      if (cleaned !== undefined) {
        res[k] = cleaned;
      }
    }
    return res;
  }
  return obj;
}

function localizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${LOCAL_MOCK_ORIGIN}${url.protocol === 'http:' || url.protocol === 'https:' ? url.pathname : ''}`;
  } catch {
    return LOCAL_MOCK_ORIGIN;
  }
}

function localizeApiBaseUrl(value: unknown): unknown {
  if (typeof value === 'string') return localizeUrl(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([api, url]) => [
        api,
        typeof url === 'string' ? localizeUrl(url) : url,
      ])
    );
  }
  return value;
}

function generateMockInferenceKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `sk-dev-${slug || 'key'}-00000000000000000000000000000000`;
}

function isSensitiveField(name: string): boolean {
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const finalSegment = normalized.split(/[-_]/).at(-1);
  return new Set([
    'authorization',
    'cookie',
    'credential',
    'credentials',
    'key',
    'password',
    'secret',
    'session',
    'token',
  ]).has(finalSegment ?? '');
}

function redactPrimitive(value: unknown, fieldName: string): unknown {
  if (typeof value === 'string') {
    return `mock-${fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-value`;
  }
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return value;
}

export function redactSensitiveValues(
  value: unknown,
  parentKey?: string,
  redactEntireSubtree = false
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item, parentKey, redactEntireSubtree));
  }
  if (!value || typeof value !== 'object') {
    return redactEntireSubtree ? redactPrimitive(value, parentKey ?? 'secret') : value;
  }

  const redactAllChildren =
    redactEntireSubtree ||
    parentKey?.toLowerCase() === 'headers' ||
    isSensitiveField(parentKey ?? '');
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      redactSensitiveValues(child, key, redactAllChildren || isSensitiveField(key)),
    ])
  );
}

export function buildPopulate(stagingData: any) {
  // 1. Map Providers
  const providers: Record<string, any> = {};
  for (const [name, config] of Object.entries(stagingData.providers || {})) {
    const cleanConfig = cleanNulls({ ...(config as any) });
    const originalApiKey = cleanConfig.api_key;
    const safeConfig = redactSensitiveValues(cleanConfig) as Record<string, any>;
    if (typeof originalApiKey === 'string') {
      safeConfig.api_key = generateMockKey(name, originalApiKey);
    }
    safeConfig.api_base_url = localizeApiBaseUrl(safeConfig.api_base_url);
    if (safeConfig.quota_checker) {
      safeConfig.quota_checker.enabled = false;
      if (safeConfig.quota_checker.options?.endpoint) {
        safeConfig.quota_checker.options.endpoint = `${LOCAL_MOCK_ORIGIN}/mock/quota`;
      }
    }
    providers[name] = safeConfig;
  }

  // 2. Map Quotas (user_quotas in backup -> quotas in default-populate)
  const quotas = cleanNulls(stagingData.user_quotas || {});

  // 3. Map Aliases (models in backup -> aliases in default-populate)
  const aliases = cleanNulls(stagingData.models || {});

  // 4. Map Keys and replace every source secret with a deterministic dev-only value.
  const keys = cleanNulls(stagingData.keys || {});
  const routableModels = new Set(Object.keys(aliases));
  for (const alias of Object.values(aliases) as Record<string, any>[]) {
    for (const additionalAlias of alias.additional_aliases ?? []) {
      routableModels.add(additionalAlias);
    }
  }
  for (const [name, config] of Object.entries(keys)) {
    const keyConfig = config as Record<string, any>;
    keyConfig.secret = generateMockInferenceKey(name);
    if (Array.isArray(keyConfig.allowedModels)) {
      keyConfig.allowedModels = keyConfig.allowedModels.filter((model: string) =>
        routableModels.has(model)
      );
    }
  }

  return { providers, quotas, aliases, keys };
}

function main() {
  const scriptsDir = import.meta.dir;
  const backupPath = join('/tmp', 'staging-config.json');
  const outputPath = join(scriptsDir, 'default-populate.json');

  if (!existsSync(backupPath)) {
    console.error(`Error: Backup file not found at ${backupPath}`);
    process.exit(1);
  }

  console.log(`Reading backup from ${backupPath}...`);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  if (!backup.data) {
    console.error('Error: No data object found in backup');
    process.exit(1);
  }

  const populate = buildPopulate(backup.data);
  console.log(`Writing transformed populate configuration to ${outputPath}...`);
  writeFileSync(outputPath, JSON.stringify(populate, null, 2), 'utf8');
  console.log('✓ Successfully created safe default-populate.json fixtures!');
}

if (import.meta.main) main();
