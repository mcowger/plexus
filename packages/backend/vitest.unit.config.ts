import { defineProject } from 'vitest/config';
import baseConfig from './vitest.config';
import { DB_TEST_FILES } from './vitest.db-tests';

const baseTestConfig = { ...baseConfig.test };
delete (baseTestConfig as { projects?: unknown }).projects;

export default defineProject({
  ...baseConfig,
  test: {
    ...baseTestConfig,
    name: 'unit',
    // DB tests run in the sqlite and postgres projects; exclude them here so
    // they don't get a redundant third run with no dialect configured.
    exclude: [...(baseTestConfig.exclude ?? []), ...DB_TEST_FILES],
    // Unit tests reuse an isolated SQLite worker database when a DB-backed
    // singleton is exercised, but do not initialize a separate template.
    globalSetup: [],
    env: {
      ...baseTestConfig.env,
      PLEXUS_TEST_DIALECT: 'unit',
    },
  },
});
