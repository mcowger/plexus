import { defineProject } from 'vitest/config';
import baseConfig from './vitest.config';
import { DB_TEST_FILES } from './vitest.db-tests';

export default defineProject({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: 'sqlite',
    include: [...DB_TEST_FILES],
    env: {
      ...baseConfig.test?.env,
      PLEXUS_TEST_DIALECT: 'sqlite',
    },
  },
});
