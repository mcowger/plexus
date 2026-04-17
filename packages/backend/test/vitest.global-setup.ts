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

export default async function globalSetup() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(moduleDir, '..');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-vitest-'));
  const testDialect = process.env.PLEXUS_TEST_DIALECT === 'postgres' ? 'postgres' : 'sqlite';

  const sqliteTemplatePath = path.join(tmpRoot, 'vitest-template.sqlite');
  const postgresTemplateDir = path.join(tmpRoot, 'vitest-template.pglite');
  const defaultDbUrl =
    testDialect === 'postgres'
      ? 'postgres://postgres:postgres@localhost:5432/plexus_test'
      : `sqlite://${sqliteTemplatePath}`;
  const testDbUrl = process.env.PLEXUS_TEST_DB_URL || defaultDbUrl;

  process.env.PLEXUS_TEST_DB_URL = testDbUrl;
  process.env.PLEXUS_TEST_DB_TMP_ROOT = tmpRoot;
  process.env.PLEXUS_TEST_DIALECT = testDialect;
  process.env.DATABASE_URL = testDbUrl;

  if (testDialect === 'sqlite') {
    process.env.PLEXUS_TEST_DB_TEMPLATE_URL = testDbUrl;
    delete process.env.PLEXUS_TEST_PGLITE_TEMPLATE_DIR;
    delete process.env.PLEXUS_PGLITE_DATA_DIR;
  } else {
    process.env.PLEXUS_TEST_PGLITE_TEMPLATE_DIR = postgresTemplateDir;
    process.env.PLEXUS_PGLITE_DATA_DIR = postgresTemplateDir;
    delete process.env.PLEXUS_TEST_DB_TEMPLATE_URL;
  }

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

  if (testDialect === 'postgres') {
    const finalTemplateDir = process.env.PLEXUS_TEST_PGLITE_TEMPLATE_DIR!;
    if (!fs.existsSync(finalTemplateDir)) {
      fs.mkdirSync(finalTemplateDir, { recursive: true });
    }
    // Ensure the template directory exists even if pglite created it lazily.
    const currentDir = process.env.PLEXUS_PGLITE_DATA_DIR;
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
    delete process.env.PLEXUS_TEST_DB_TEMPLATE_URL;
    delete process.env.PLEXUS_TEST_PGLITE_TEMPLATE_DIR;
    delete process.env.PLEXUS_TEST_DB_URL;
    delete process.env.PLEXUS_TEST_DB_TMP_ROOT;
    delete process.env.PLEXUS_PGLITE_DATA_DIR;
  };
}
