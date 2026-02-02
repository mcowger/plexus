import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { getDatabase } from './client';
import { logger } from '../utils/logger';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  try {
    const db = getDatabase();
    logger.info('Running database migrations...');
    
    await migrate(db, { 
      migrationsFolder: path.join(__dirname, '../../drizzle/migrations')
    });
    
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', error);
    throw error;
  }
}
