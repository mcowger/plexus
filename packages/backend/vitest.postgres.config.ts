import { defineProject } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineProject({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: 'postgres',
    env: {
      ...baseConfig.test?.env,
      PLEXUS_TEST_DIALECT: 'postgres',
      PLEXUS_POSTGRES_DRIVER: 'pglite',
    },
  },
});
