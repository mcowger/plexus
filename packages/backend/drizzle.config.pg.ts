import { defineConfig } from 'drizzle-kit';

// if (!process.env.DATABASE_URL) {
//   throw new Error('DATABASE_URL environment variable is required');
// }

export default defineConfig({
  schema: './drizzle/schema/postgres/index.ts',
  out: './drizzle/migrations_pg',
  dialect: 'postgresql',
  // dbCredentials: {
  //   url: process.env.DATABASE_URL,
  // },
  verbose: true,
  strict: true,
});
