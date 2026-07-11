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

export function buildPopulate(stagingData: any) {
  // 1. Map Providers
  const providers: Record<string, any> = {};
  for (const [name, config] of Object.entries(stagingData.providers || {})) {
    const cleanConfig = cleanNulls({ ...(config as any) });
    if (cleanConfig.api_key) {
      cleanConfig.api_key = generateMockKey(name, cleanConfig.api_key);
    }
    cleanConfig.api_base_url = localizeApiBaseUrl(cleanConfig.api_base_url);
    if (cleanConfig.quota_checker) {
      cleanConfig.quota_checker.enabled = false;
      if (cleanConfig.quota_checker.options?.session) {
        cleanConfig.quota_checker.options.session = 'mock-session-token';
      }
      if (cleanConfig.quota_checker.options?.endpoint) {
        cleanConfig.quota_checker.options.endpoint = `${LOCAL_MOCK_ORIGIN}/mock/quota`;
      }
    }
    // Also clean oauth credentials inside providers if they exist
    if (cleanConfig.oauth_credentials) {
      cleanConfig.oauth_credentials = cleanConfig.oauth_credentials.map((cred: any) => {
        const c = { ...cred };
        if (c.access_token) c.access_token = 'sk-mock-access-token';
        if (c.refresh_token) c.refresh_token = 'sk-mock-refresh-token';
        return c;
      });
    }
    providers[name] = cleanConfig;
  }

  // 2. Map Quotas (user_quotas in backup -> quotas in default-populate)
  const quotas = cleanNulls(stagingData.user_quotas || {});

  // 3. Map Aliases (models in backup -> aliases in default-populate)
  const aliases = cleanNulls(stagingData.models || {});

  // 4. Map Keys and replace every source secret with a deterministic dev-only value.
  const keys = cleanNulls(stagingData.keys || {});
  for (const [name, config] of Object.entries(keys)) {
    (config as Record<string, unknown>).secret = generateMockInferenceKey(name);
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
