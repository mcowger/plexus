import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './drizzle/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.PLEXUS_DB_URL || './config/usage.sqlite',
  },
  verbose: true,
  strict: true,
});
