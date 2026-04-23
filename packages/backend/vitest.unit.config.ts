import { defineProject } from 'vitest/config';
import baseConfig from './vitest.config';
import { DB_TEST_FILES } from './vitest.db-tests';

export default defineProject({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: 'unit',
    // DB tests run in the sqlite and postgres projects; exclude them here so
    // they don't get a redundant third run with no dialect configured.
    exclude: [...(baseConfig.test?.exclude ?? []), ...DB_TEST_FILES],
    // No database setup needed — all DB access is mocked via vitest.setup.ts.
    globalSetup: [],
  },
});
