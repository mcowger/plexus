import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

function generateMockKey(providerName: string, originalKey: string): string {
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
function cleanNulls(obj: any): any {
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

function main() {
  const scriptsDir = import.meta.dir;
  const backupPath = join('/tmp', 'staging-config.json');
  const outputPath = join(scriptsDir, 'default-populate.json');

  if (!existsSync(backupPath)) {
    console.error(`Error: Backup file not found at ${backupPath}`);
    process.exit(1);
  }

  console.log(`Reading backup from ${backupPath}...`);
  const raw = readFileSync(backupPath, 'utf8');
  const backup = JSON.parse(raw);

  const stagingData = backup.data;
  if (!stagingData) {
    console.error('Error: No data object found in backup');
    process.exit(1);
  }

  // 1. Map Providers
  const providers: Record<string, any> = {};
  for (const [name, config] of Object.entries(stagingData.providers || {})) {
    const cleanConfig = cleanNulls({ ...(config as any) });
    if (cleanConfig.api_key) {
      cleanConfig.api_key = generateMockKey(name, cleanConfig.api_key);
    }
    // Remove provider-specific session credentials from generated fixtures.
    if (cleanConfig.quota_checker?.options?.session) {
      cleanConfig.quota_checker.options.session = 'mock-session-token';
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

  // 4. Map Keys
  const keys = cleanNulls(stagingData.keys || {});

  // Build the unified populate object
  const populate = {
    providers,
    quotas,
    aliases,
    keys,
  };

  console.log(`Writing transformed populate configuration to ${outputPath}...`);
  writeFileSync(outputPath, JSON.stringify(populate, null, 2), 'utf8');
  console.log('✓ Successfully created default-populate.json with real-looking data!');
}

main();
