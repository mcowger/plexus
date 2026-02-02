import { migrate as migrateSqlite } from 'drizzle-orm/bun-sqlite/migrator';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { getDatabase, getCurrentDialect } from './client';
import { logger } from '../utils/logger';
import path from 'node:path';

export async function runMigrations() {
  try {
    const db = getDatabase();
    const dialect = getCurrentDialect();

    logger.info(`Running ${dialect} migrations...`);

    const migrationsBase = path.resolve(__dirname, '../../drizzle');

    if (dialect === 'sqlite') {
      const migrationsPath = process.env.DRIZZLE_MIGRATIONS_PATH 
        ? process.env.DRIZZLE_MIGRATIONS_PATH.replace('/migrations_pg', '/migrations')
        : path.join(migrationsBase, 'migrations');
      logger.info(`SQLite migrations path: ${migrationsPath}`);
      await migrateSqlite(db as any, {
        migrationsFolder: migrationsPath
      });
    } else {
      const migrationsPath = process.env.DRIZZLE_MIGRATIONS_PATH || path.join(migrationsBase, 'migrations_pg');
      logger.info(`PostgreSQL migrations path: ${migrationsPath}`);
      await migratePg(db as any, {
        migrationsFolder: migrationsPath
      });
    }

    logger.info('Migrations completed successfully');
  } catch (error: any) {
    logger.error('Migration failed', error);

    if (error.message?.includes("Can't find meta/_journal.json file")) {
      logger.error('Drizzle journal file path issue detected.');
      logger.error('This is often caused by migration file structure.');
      logger.error('Try regenerating migrations with: bunx drizzle-kit generate');
    }

    throw error;
  }
}
