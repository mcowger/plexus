import { migrate as migrateSqlite } from 'drizzle-orm/bun-sqlite/migrator';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { getDatabase, getCurrentDialect } from './client';
import { logger } from '../utils/logger';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import sqliteVfs from './migrations-vfs-sqlite';
import pgVfs from './migrations-vfs-pg';
import sqliteJournal from '../../drizzle/migrations/meta/_journal.json';
import pgJournal from '../../drizzle/migrations_pg/meta/_journal.json';

const DRIZZLE_MIGRATIONS_SCHEMA = 'drizzle';
const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations';

interface MigrationJournalEntry {
  when: number;
  tag: string;
}

function normalizeSqlStatement(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();
}

function isDuplicateColumnError(error: any): boolean {
  return error?.cause?.code === '42701' || error?.code === '42701';
}

function toIdempotentStatement(statement: string): string {
  if (
    /ALTER\s+TABLE[\s\S]+ADD\s+COLUMN/i.test(statement) &&
    !/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i.test(statement)
  ) {
    return statement.replace(/ADD\s+COLUMN\s+/i, 'ADD COLUMN IF NOT EXISTS ');
  }
  return statement;
}

async function attemptPostgresDuplicateColumnRepair(
  db: any,
  migrationsPath: string,
  migrationError: any
): Promise<boolean> {
  const failedQuery = typeof migrationError?.query === 'string' ? migrationError.query : '';
  if (!failedQuery) {
    return false;
  }

  const journalPath = path.join(migrationsPath, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    return false;
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries?: MigrationJournalEntry[];
  };
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  const normalizedFailedQuery = normalizeSqlStatement(failedQuery);

  for (const entry of entries) {
    const migrationPath = path.join(migrationsPath, `${entry.tag}.sql`);
    if (!fs.existsSync(migrationPath)) {
      continue;
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    const includesFailedQuery = statements.some(
      (statement) => normalizeSqlStatement(statement) === normalizedFailedQuery
    );
    if (!includesFailedQuery) {
      continue;
    }

    logger.warn(
      `Detected duplicate-column migration drift in ${entry.tag}; applying idempotent repair`
    );

    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${DRIZZLE_MIGRATIONS_SCHEMA}"`));
    await db.execute(
      sql.raw(`
      CREATE TABLE IF NOT EXISTS "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)
    );

    for (const statement of statements) {
      const repairedStatement = toIdempotentStatement(statement);
      try {
        await db.execute(sql.raw(repairedStatement));
      } catch (statementError: any) {
        const isAddColumnStatement = /ALTER\s+TABLE[\s\S]+ADD\s+COLUMN/i.test(repairedStatement);
        if (isAddColumnStatement && isDuplicateColumnError(statementError)) {
          continue;
        }
        throw statementError;
      }
    }

    const hash = crypto.createHash('sha256').update(migrationSql).digest('hex');
    await db.execute(
      sql.raw(`
      INSERT INTO "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}" ("hash", "created_at")
      SELECT '${hash}', ${entry.when}
      WHERE NOT EXISTS (
        SELECT 1 FROM "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}"
        WHERE "created_at" = ${entry.when}
      )
    `)
    );

    return true;
  }

  return false;
}

// Cached tmpdir paths per dialect — written once per process.
const migrationsDirCache = new Map<string, string>();

/**
 * Writes the VFS migration files (SQL + journal) for the given dialect to a
 * stable per-process temporary directory and returns that directory path.
 *
 * Both dev (source) and compiled binary modes use this path — the VFS modules
 * are generated at build time by `make-vfs` and bundled as standard TypeScript,
 * so no Bun.embeddedFiles or filesystem hacks are needed.
 */
async function getMigrationsDir(dialect: 'sqlite' | 'postgres'): Promise<string> {
  const cached = migrationsDirCache.get(dialect);
  if (cached) return cached;

  const vfs = dialect === 'sqlite' ? sqliteVfs : pgVfs;
  const journal = dialect === 'sqlite' ? sqliteJournal : pgJournal;

  const tmpDir = path.join(os.tmpdir(), `plexus-migrations-${process.pid}-${dialect}`);
  fs.mkdirSync(path.join(tmpDir, 'meta'), { recursive: true });

  for (const [filename, content] of Object.entries(vfs)) {
    fs.writeFileSync(path.join(tmpDir, filename), content as string);
  }

  fs.writeFileSync(path.join(tmpDir, 'meta', '_journal.json'), JSON.stringify(journal));

  process.once(`exit`, () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; ignore errors.
    }
  });

  migrationsDirCache.set(dialect, tmpDir);
  logger.debug(`Migrations for ${dialect} written to ${tmpDir}`);
  return tmpDir;
}

export async function runMigrations() {
  try {
    const db = getDatabase();
    const dialect = getCurrentDialect();

    logger.info(`Running ${dialect} migrations...`);

    if (dialect === 'sqlite') {
      const migrationsPath = process.env.DRIZZLE_MIGRATIONS_PATH
        ? process.env.DRIZZLE_MIGRATIONS_PATH.replace('/migrations_pg', '/migrations')
        : await getMigrationsDir('sqlite');
      logger.info(`SQLite migrations path: ${migrationsPath}`);
      await migrateSqlite(db as any, {
        migrationsFolder: migrationsPath,
      });
    } else {
      const migrationsPath =
        process.env.DRIZZLE_MIGRATIONS_PATH || (await getMigrationsDir('postgres'));
      logger.info(`PostgreSQL migrations path: ${migrationsPath}`);
      try {
        await migratePg(db as any, {
          migrationsFolder: migrationsPath,
        });
      } catch (error: any) {
        if (isDuplicateColumnError(error)) {
          const repaired = await attemptPostgresDuplicateColumnRepair(
            db as any,
            migrationsPath,
            error
          );
          if (repaired) {
            logger.warn('Retrying PostgreSQL migrations after duplicate-column repair');
            await migratePg(db as any, {
              migrationsFolder: migrationsPath,
            });
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
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
