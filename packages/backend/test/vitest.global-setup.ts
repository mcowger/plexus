import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

export default async function globalSetup() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(moduleDir, '..');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-vitest-'));
  const defaultDbPath = path.join(tmpRoot, 'vitest-template.sqlite');
  const testDbUrl = process.env.PLEXUS_TEST_DB_URL || `sqlite://${defaultDbPath}`;
  process.env.PLEXUS_TEST_DB_TEMPLATE_URL = testDbUrl;
  process.env.PLEXUS_TEST_DB_URL = testDbUrl;
  process.env.PLEXUS_TEST_DB_TMP_ROOT = tmpRoot;
  process.env.DATABASE_URL = process.env.DATABASE_URL || testDbUrl;

  const originalLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'error';

  try {
    execSync('bunx drizzle-kit generate --config=drizzle.config.sqlite.ts', {
      cwd: backendRoot,
      stdio: 'pipe',
    });
    execSync('bunx drizzle-kit generate --config=drizzle.config.postgres.ts', {
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

  const testConfig = `
database:
  connection_string: "${testDbUrl}"
adminKey: test-key
providers: {}
models: {}
keys: {}
`;

  configModule.setConfigForTesting(configModule.validateConfig(testConfig));
  initializeDatabase(testDbUrl);
  await runMigrations();
  await closeDatabase();

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
    delete process.env.PLEXUS_TEST_DB_TEMPLATE_URL;
    delete process.env.PLEXUS_TEST_DB_URL;
    delete process.env.PLEXUS_TEST_DB_TMP_ROOT;
  };
}
