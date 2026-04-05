import { migrate as migrateSqlite } from 'drizzle-orm/bun-sqlite/migrator';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { getDatabase, getCurrentDialect } from './client';
import { logger } from '../utils/logger';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { sqliteJournal, pgJournal } from './migrations-bundle';

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

/**
 * When running as a compiled Bun binary, drizzle migration SQL files are
 * embedded as assets via `bun build --compile --asset-naming="[name].[ext]"`.
 * They are accessible through `Bun.embeddedFiles` with their original basenames.
 * The `_journal.json` files are NOT embedded as assets (bun transpiles JSON to
 * JS); instead they are statically imported via migrations-bundle.ts.
 *
 * This function extracts the relevant SQL files and writes the journal to a
 * temporary directory so the standard drizzle migrator can read them.
 *
 * Returns the path to the temp directory on success, or null if no embedded
 * migration files were found (i.e., running from source in development mode).
 */

/** Bun embedded-file entry: a Blob with an additional `name` (original path). */
interface BunEmbeddedFile extends Blob {
  name: string;
}

async function extractEmbeddedMigrations(dialect: 'sqlite' | 'postgres'): Promise<string | null> {
  const embeddedFiles: BunEmbeddedFile[] =
    typeof globalThis.Bun !== 'undefined' && 'embeddedFiles' in globalThis.Bun
      ? (globalThis.Bun as unknown as { embeddedFiles: BunEmbeddedFile[] }).embeddedFiles
      : [];

  if (embeddedFiles.length === 0) {
    return null;
  }

  // The journal is bundled as JS via migrations-bundle.ts. Use it to get the
  // set of expected SQL filenames for this dialect.
  const journal = dialect === 'sqlite' ? sqliteJournal : pgJournal;
  const expectedTags = new Set(journal.entries.map((e: { tag: string }) => e.tag));

  // SQL files are embedded with their original basename (--asset-naming="[name].[ext]").
  // Match by checking if the basename (without .sql) is a known journal tag.
  const relevant = embeddedFiles.filter((f) => {
    const tag = f.name.replace(/\.sql$/, '');
    return expectedTags.has(tag);
  });

  if (relevant.length === 0) {
    return null;
  }

  // Use a stable, per-process temp directory — reused on retry, cleaned up on exit.
  const tmpDir = path.join(os.tmpdir(), `plexus-migrations-${process.pid}-${dialect}`);
  fs.mkdirSync(path.join(tmpDir, 'meta'), { recursive: true });

  // Register a one-time cleanup handler.
  process.once('exit', () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; ignore errors.
    }
  });

  // Write SQL files.
  for (const file of relevant) {
    fs.writeFileSync(path.join(tmpDir, file.name), await file.text());
  }

  // Write the journal (bundled as JS, not available as an embedded asset).
  fs.writeFileSync(path.join(tmpDir, 'meta', '_journal.json'), JSON.stringify(journal));

  logger.info(`Extracted ${relevant.length} embedded migration files to ${tmpDir}`);
  return tmpDir;
}

export async function runMigrations() {
  try {
    const db = getDatabase();
    const dialect = getCurrentDialect();

    logger.info(`Running ${dialect} migrations...`);

    const migrationsBase = path.resolve(__dirname, '../../drizzle');

    if (dialect === 'sqlite') {
      const embeddedPath = await extractEmbeddedMigrations('sqlite');
      const migrationsPath =
        embeddedPath ||
        (process.env.DRIZZLE_MIGRATIONS_PATH
          ? process.env.DRIZZLE_MIGRATIONS_PATH.replace('/migrations_pg', '/migrations')
          : path.join(migrationsBase, 'migrations'));
      logger.info(`SQLite migrations path: ${migrationsPath}`);
      await migrateSqlite(db as any, {
        migrationsFolder: migrationsPath,
      });
    } else {
      const embeddedPath = await extractEmbeddedMigrations('postgres');
      const migrationsPath =
        embeddedPath ||
        process.env.DRIZZLE_MIGRATIONS_PATH ||
        path.join(migrationsBase, 'migrations_pg');
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
