import { defineProject } from 'vitest/config';
import baseConfig from './vitest.config.ts';
import { DB_TEST_FILES } from './vitest.db-tests.ts';

const baseTestConfig = { ...baseConfig.test };
delete (baseTestConfig as { projects?: unknown }).projects;

export default defineProject({
  ...baseConfig,
  test: {
    ...baseTestConfig,
    name: 'sqlite',
    globalSetup: ['./test/vitest.sqlite.global-setup.ts'],
    include: [...DB_TEST_FILES],
    env: {
      ...baseTestConfig.env,
      PLEXUS_TEST_DIALECT: 'sqlite',
    },
  },
});
