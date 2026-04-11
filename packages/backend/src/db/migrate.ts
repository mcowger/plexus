import { sql } from 'drizzle-orm';
import { getDatabase, getCurrentDialect } from './client';
import { logger } from '../utils/logger';
import crypto from 'node:crypto';
import sqliteVfs from './migrations-vfs-sqlite';
import pgVfs from './migrations-vfs-pg';
import sqliteJournal from '../../drizzle/migrations/meta/_journal.json';
import pgJournal from '../../drizzle/migrations_pg/meta/_journal.json';

const DRIZZLE_MIGRATIONS_SCHEMA = 'drizzle';
const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations';

// Shape expected by db.dialect.migrate() — mirrors drizzle-orm's internal MigrationMeta.
interface MigrationMeta {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
}

type Journal = { entries: Array<{ tag: string; when: number; breakpoints: boolean }> };

/**
 * Builds the MigrationMeta[] array that drizzle's dialect.migrate() expects,
 * sourcing SQL content from the VFS module instead of the filesystem.
 * This replicates what drizzle-orm's readMigrationFiles() does, minus the fs calls.
 */
function migrationsFromVfs(vfs: Record<string, string>, journal: Journal): MigrationMeta[] {
  return journal.entries.map((entry) => {
    const content = vfs[`${entry.tag}.sql`];
    if (!content) throw new Error(`Missing migration in VFS: ${entry.tag}`);
    return {
      sql: content.split('--> statement-breakpoint'),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });
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
  migrationError: any
): Promise<boolean> {
  const failedQuery = typeof migrationError?.query === 'string' ? migrationError.query : '';
  if (!failedQuery) return false;

  const normalizedFailedQuery = normalizeSqlStatement(failedQuery);

  for (const entry of pgJournal.entries) {
    const migrationSql = pgVfs[`${entry.tag}.sql` as keyof typeof pgVfs] as string | undefined;
    if (!migrationSql) continue;

    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (!statements.some((s) => normalizeSqlStatement(s) === normalizedFailedQuery)) continue;

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
        if (isAddColumnStatement && isDuplicateColumnError(statementError)) continue;
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

export async function runMigrations() {
  try {
    const db = getDatabase();
    const dialect = getCurrentDialect();

    logger.info(`Running ${dialect} migrations from VFS...`);

    if (dialect === 'sqlite') {
      const migrations = migrationsFromVfs(sqliteVfs, sqliteJournal as Journal);
      (db as any).dialect.migrate(migrations, (db as any).session, {
        migrationsFolder: '',
      });
    } else {
      const migrations = migrationsFromVfs(pgVfs, pgJournal as Journal);
      try {
        await (db as any).dialect.migrate(migrations, (db as any).session, {
          migrationsFolder: '',
          migrationsSchema: DRIZZLE_MIGRATIONS_SCHEMA,
          migrationsTable: DRIZZLE_MIGRATIONS_TABLE,
        });
      } catch (error: any) {
        if (isDuplicateColumnError(error)) {
          const repaired = await attemptPostgresDuplicateColumnRepair(db as any, error);
          if (repaired) {
            logger.warn('Retrying PostgreSQL migrations after duplicate-column repair');
            await (db as any).dialect.migrate(migrations, (db as any).session, {
              migrationsFolder: '',
              migrationsSchema: DRIZZLE_MIGRATIONS_SCHEMA,
              migrationsTable: DRIZZLE_MIGRATIONS_TABLE,
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
    throw error;
  }
}
