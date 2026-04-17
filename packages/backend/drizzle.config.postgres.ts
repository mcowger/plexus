import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './drizzle/schema/postgres',
  out: './drizzle/migrations_pg',
  dialect: 'postgresql',
  // dbCredentials not needed for migration generation;
  // uncomment if using drizzle-kit push/migrate against a live database.
  // dbCredentials: {
  //   url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/plexus',
  // },
  verbose: true,
  strict: true,
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
