import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

function copyDirectory(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

export type TestDialect = 'sqlite' | 'postgres';

export async function setupTestDatabase(testDialect: TestDialect) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(moduleDir, '..');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-vitest-'));
  const managedEnvKeys = [
    'PLEXUS_TEST_DB_URL',
    'PLEXUS_TEST_DB_TMP_ROOT',
    'PLEXUS_TEST_DIALECT',
    'PLEXUS_TEST_DB_TEMPLATE_URL',
    'PLEXUS_TEST_PGLITE_TEMPLATE_DIR',
    'PLEXUS_TEST_SQLITE_TEMPLATE_URL',
    'PLEXUS_TEST_SQLITE_TMP_ROOT',
    'PLEXUS_TEST_POSTGRES_TEMPLATE_DIR',
    'PLEXUS_TEST_POSTGRES_TMP_ROOT',
    'PLEXUS_TEST_POSTGRES_DB_URL',
    'PLEXUS_PGLITE_DATA_DIR',
    'PLEXUS_POSTGRES_DRIVER',
    'DATABASE_URL',
  ];
  const originalEnv = new Map(managedEnvKeys.map((key) => [key, process.env[key]]));

  const sqliteTemplatePath = path.join(tmpRoot, 'vitest-template.sqlite');
  const postgresTemplateDir = path.join(tmpRoot, 'vitest-template.pglite');
  const configuredDbUrl = process.env.PLEXUS_TEST_DB_URL;
  const defaultDbUrl =
    testDialect === 'postgres'
      ? 'postgres://postgres:postgres@localhost:5432/plexus_test'
      : `sqlite://${sqliteTemplatePath}`;
  const configuredDbMatchesDialect =
    configuredDbUrl?.startsWith(testDialect === 'postgres' ? 'postgres' : 'sqlite') ?? false;
  const testDbUrl = configuredDbMatchesDialect ? configuredDbUrl! : defaultDbUrl;

  process.env.PLEXUS_TEST_DB_URL = testDbUrl;
  process.env.PLEXUS_TEST_DB_TMP_ROOT = tmpRoot;
  process.env.PLEXUS_TEST_DIALECT = testDialect;
  process.env.DATABASE_URL = testDbUrl;
  if (testDialect === 'postgres') {
    process.env.PLEXUS_POSTGRES_DRIVER = 'pglite';
  } else {
    delete process.env.PLEXUS_POSTGRES_DRIVER;
  }

  if (testDialect === 'sqlite') {
    process.env.PLEXUS_TEST_DB_TEMPLATE_URL = testDbUrl;
    process.env.PLEXUS_TEST_SQLITE_TEMPLATE_URL = testDbUrl;
    process.env.PLEXUS_TEST_SQLITE_TMP_ROOT = tmpRoot;
    delete process.env.PLEXUS_TEST_PGLITE_TEMPLATE_DIR;
    delete process.env.PLEXUS_PGLITE_DATA_DIR;
  } else {
    process.env.PLEXUS_TEST_PGLITE_TEMPLATE_DIR = postgresTemplateDir;
    process.env.PLEXUS_TEST_POSTGRES_TEMPLATE_DIR = postgresTemplateDir;
    process.env.PLEXUS_TEST_POSTGRES_TMP_ROOT = tmpRoot;
    process.env.PLEXUS_TEST_POSTGRES_DB_URL = testDbUrl;
    process.env.PLEXUS_PGLITE_DATA_DIR = postgresTemplateDir;
    delete process.env.PLEXUS_TEST_DB_TEMPLATE_URL;
  }

  const originalLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'error';

  try {
    execSync('bun run generate-migrations --name test_setup', {
      cwd: backendRoot,
      stdio: 'pipe',
    });
  } catch {
    // ignore if already generated
  }

  const [{ initializeDatabase, closeDatabase }, { runMigrations }, configModule] =
    await Promise.all([
      import('../src/db/client'),
      import('../src/db/migrate'),
      import('../src/config'),
    ]);

  const testConfig = JSON.stringify({
    database: {
      connection_string: testDbUrl,
    },
    adminKey: 'test-key',
    providers: {},
    models: {},
    keys: {},
  });

  configModule.setConfigForTesting(configModule.validateConfig(testConfig));
  initializeDatabase(testDbUrl);
  await runMigrations();
  await closeDatabase();

  if (testDialect === 'postgres') {
    const finalTemplateDir = postgresTemplateDir;
    if (!fs.existsSync(finalTemplateDir)) {
      fs.mkdirSync(finalTemplateDir, { recursive: true });
    }
    // Ensure the template directory exists even if pglite created it lazily.
    const currentDir = postgresTemplateDir;
    if (currentDir && currentDir !== finalTemplateDir && fs.existsSync(currentDir)) {
      copyDirectory(currentDir, finalTemplateDir);
    }
  }

  if (originalLogLevel === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = originalLogLevel;
  }

  return async () => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup errors
    }
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

export default async function globalSetup() {
  const testDialect: TestDialect =
    process.env.PLEXUS_TEST_DIALECT === 'postgres' ? 'postgres' : 'sqlite';
  return setupTestDatabase(testDialect);
}
