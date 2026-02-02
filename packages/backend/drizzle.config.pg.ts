import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './drizzle/schema/postgres/index.ts',
  out: './drizzle/migrations_pg',
  dialect: 'postgresql',
  dbCredentials: {
    url: 'postgres://plexus:plexus@192.168.0.2:5432/plexus',
  },
  verbose: true,
  strict: true,
});
