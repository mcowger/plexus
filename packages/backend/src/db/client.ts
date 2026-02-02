import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../drizzle/schema';
import { logger } from '../utils/logger';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function initializeDatabase(connectionString?: string) {
  const effectiveConnectionString = connectionString || process.env.PLEXUS_DB_URL;
  
  let dbPath: string;
  
  if (effectiveConnectionString) {
    dbPath = effectiveConnectionString;
  } else {
    let dbDir = process.env.DATA_DIR;
    if (!dbDir) {
      const possibleRoot = path.resolve(process.cwd(), '../../');
      const localConfig = path.resolve(process.cwd(), 'config');
      
      if (fs.existsSync(path.join(possibleRoot, 'config', 'plexus.yaml'))) {
        dbDir = path.join(possibleRoot, 'config');
      } else if (fs.existsSync(path.join(localConfig, 'plexus.yaml'))) {
        dbDir = localConfig;
      } else {
        dbDir = path.resolve(process.cwd(), 'data');
      }
    }
    
    if (!fs.existsSync(dbDir)) {
      try {
        fs.mkdirSync(dbDir, { recursive: true });
      } catch (e) {
        logger.error(`Failed to create data directory at ${dbDir}`, e);
        dbDir = path.resolve(process.cwd(), 'data');
        fs.mkdirSync(dbDir, { recursive: true });
      }
    }
    dbPath = path.join(dbDir, 'usage.sqlite');
  }
  
  logger.info(`Initializing database at ${dbPath}`);

  try {
    const sqlite = new Database(dbPath);

    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA foreign_keys = ON');

    dbInstance = drizzle(sqlite, {
      schema,
      logger: process.env.LOG_LEVEL === 'debug',
    });

    return dbInstance;
  } catch (error) {
    logger.error(`Failed to initialize database at ${dbPath}`, error);
    throw error;
  }
}

export function getDatabase() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbInstance;
}
